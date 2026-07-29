#!/usr/bin/env node
// Evaluation runner CLI (Milestone M7a).
//
//   node evals/run.js --mode replay                     offline, free, deterministic
//   node evals/run.js --mode live --record --repeat 3   the baseline run
//   node evals/run.js --mode live --filter stratum=commands,language=hinglish
//   node evals/run.js --mode live --max-calls 500       cost circuit breaker
//   node evals/run.js --mode replay --promote           write baselines/baseline.json
//
// Live mode needs GEMINI_API_KEY. It is read from server/.env through dotenv the
// same way the app reads it — this script NEVER writes to .env and never sets a
// flag on process.env, matching the M5/M6 verification practice.
//
// Exit codes: 0 all hard gates pass · 1 a hard gate failed · 2 the run itself
// could not complete (corpus invalid, cassette miss, no key). Quality thresholds
// do NOT affect the exit code — per the M7a authorization they are
// informational until the first baseline has been reviewed.

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runCorpus } = require('./lib/runner');
const { writeRun, toBaseline, fmt } = require('./lib/report');

const RUNS_DIR = path.join(__dirname, 'runs');
const { FROZEN_BASELINE, loadFrozenBaseline } = require('./lib/baselines');

function parseArgs(argv) {
  const args = { mode: 'replay', record: false, repeat: 1, filter: null, maxCalls: Infinity, promote: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') args.mode = argv[++i];
    else if (arg === '--record') args.record = true;
    else if (arg === '--promote') args.promote = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--repeat') args.repeat = Number(argv[++i]);
    else if (arg === '--filter') args.filter = argv[++i];
    else if (arg === '--max-calls') args.maxCalls = Number(argv[++i]);
    else if (arg === '--pace-ms') args.paceMs = Number(argv[++i]);
    else if (arg === '--half') args.half = argv[++i];
    else if (arg === '--cassette-file') args.cassetteFile = argv[++i];
    else if (arg === '--label') args.label = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument "${arg}". Try --help.`);
  }
  return args;
}

const USAGE = `AI Action Router — evaluation runner

  --mode live|replay   default: replay
  --record             live only: write cassettes from this run
  --repeat N           live only: passes per case, for a variance band
  --filter k=v,...     live only: refused in replay mode
  --max-calls N        abort after N upstream calls and report what completed
  --pace-ms N          live only: minimum spacing between upstream calls
                       (default 4200 ~= 14 rpm; a saturated rate limiter shows
                       up as a wall of classifier_error and scores as false
                       negatives, so do not lower this without checking quota)
  --half dev|holdout   live only: iterate on one half of the frozen corpus.
                       Refused in replay mode. Does NOT modify the corpus
  --cassette-file P    record/replay against a specific cassette file. The M7a
                       classifier.json is FROZEN and cannot be written
  --label NAME         name this run in its directory, e.g. --label c1-recall
  --promote FILE       write a baseline. baselines/baseline.json is the frozen
                       M7a reference and is never overwritten
  --quiet              suppress per-case progress
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (args.mode === 'live' && !process.env.GEMINI_API_KEY) {
    process.stderr.write('GEMINI_API_KEY is not set — live mode cannot run.\n');
    return 2;
  }

  const started = Date.now();
  const { scored, metrics, meta } = await runCorpus({
    mode: args.mode,
    record: args.record,
    repeat: args.repeat,
    filter: args.filter,
    maxCalls: args.maxCalls,
    paceMs: args.paceMs,
    half: args.half,
    cassetteFile: args.cassetteFile,
    onProgress: args.quiet
      ? () => {}
      : ({ pass, id, done, total }) => {
          process.stderr.write(`\r  pass ${pass + 1}  ${String(done).padStart(3)}/${total}  ${id.padEnd(24)}`);
        },
  });
  if (!args.quiet) process.stderr.write('\n');

  // Model drift is annotated rather than merely recorded: the endpoint is a
  // floating alias, so a score change may be the model moving under the run.
  if (fs.existsSync(FROZEN_BASELINE)) {
    const baseline = loadFrozenBaseline();
    meta.baselineModelVersion = baseline.modelVersion;
    meta.modelDrift = Boolean(baseline.modelVersion && meta.modelVersion && baseline.modelVersion !== meta.modelVersion);
  }

  const stamp = meta.startedAt.replace(/[:.]/g, '-');
  const dir = path.join(RUNS_DIR, `${stamp}-${args.mode}${args.half && args.half !== 'all' ? `-${args.half}` : ''}${args.label ? `-${args.label}` : ''}`);
  writeRun({ dir, metrics, scored, meta });

  const gatesPass = Object.values(metrics.hardGates).every((gate) => gate.pass);

  process.stdout.write('\n');
  process.stdout.write(`mode           ${meta.mode}\n`);
  process.stdout.write(`modelVersion   ${meta.modelVersion ?? 'n/a'}\n`);
  process.stdout.write(`prompt/desc/reg ${meta.promptHash} / ${meta.descriptorHash} / ${meta.registryHash}\n`);
  process.stdout.write(`corpus         ${meta.corpusHash}  (${metrics.totals.turns} turns)\n`);
  process.stdout.write(`elapsed        ${((Date.now() - started) / 1000).toFixed(1)}s, ${meta.totalClassifierCalls} upstream calls\n`);
  process.stdout.write('\n');
  process.stdout.write(`precision      ${fmt(metrics.routing.precision)}\n`);
  process.stdout.write(`recall         ${fmt(metrics.routing.recall)}\n`);
  process.stdout.write(`hinglish prec  ${fmt(metrics.byLanguage.hinglish.precision)}\n`);
  process.stdout.write(`grade accuracy ${fmt(metrics.slots.grade.valueAccuracy)}\n`);
  process.stdout.write(`false pos/neg  ${metrics.falsePositives.total} / ${metrics.falseNegatives.total}\n`);
  process.stdout.write('\n');
  for (const [name, gate] of Object.entries(metrics.hardGates)) {
    process.stdout.write(`  ${gate.pass ? 'PASS' : 'FAIL'}  ${name}${gate.pass ? '' : `  -> ${gate.offenders.join(', ')}`}\n`);
  }
  if (meta.stability) {
    process.stdout.write(`\nstability      ${meta.stability.flipped}/${meta.stability.of} turns flipped across ${meta.stability.passes} passes\n`);
  }
  if (meta.modelDrift) {
    process.stdout.write(`\n** MODEL DRIFT ** baseline ${meta.baselineModelVersion} -> observed ${meta.modelVersion}\n`);
  }
  process.stdout.write(`\nreport         ${path.relative(process.cwd(), dir)}\n`);

  if (args.promote) {
    // The M7a baseline is the immutable reference every future change is
    // compared against (M7b decision D1). Overwriting it would silently rewrite
    // the numbers a comparison is meant to be honest about, so it is refused
    // here as well as being unreachable by accident: a bare --promote names it.
    const target = path.resolve(args.promote === true ? FROZEN_BASELINE : args.promote);
    if (target === path.resolve(FROZEN_BASELINE)) {
      process.stderr.write(
        'baselines/baseline.json is the FROZEN M7a reference and is never overwritten (M7b decision D1).\n' +
          'Promote to a new file: --promote evals/baselines/<name>.json\n'
      );
      return 2;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(toBaseline({ metrics, scored, meta }), null, 2)}\n`, 'utf8');
    process.stdout.write(`baseline       ${path.relative(process.cwd(), target)} written\n`);
  }

  return gatesPass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`\n${error.stack || error.message}\n`);
    process.exit(2);
  });
