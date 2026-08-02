// Report emitters (Milestone M7a). Deterministic by construction.
//
// REGRESSION-FRIENDLINESS IS A FORMATTING PROPERTY, and it comes down to three
// rules that exist so `git diff` between two runs is readable:
//
//   1. Everything volatile lives in run.json, NEVER in summary.md's body.
//      Timestamps, latencies and cost estimates change on every run; a summary
//      containing them diffs on every run and stops being reviewable in a week.
//   2. Percentages are derived from integer counts and printed to one decimal.
//      No floating-point noise in a committed artifact.
//   3. Case order is CORPUS order — never sorted by score, never completion
//      order. The same case occupies the same line in every run.
//
// THRESHOLDS ARE INFORMATIONAL. Per the M7a authorization, the Definition of
// Done's numbers are reported and compared but do NOT produce a pass/fail
// verdict: they are frozen only after the first baseline has been reviewed. The
// HARD GATES are different — they are safety properties, not quality targets,
// and they do block.

const fs = require('fs');
const path = require('path');

/**
 * Informational reference points, shown beside the measured value.
 *
 * Sourced from documents, not invented here: the first three are the Definition
 * of Done (spec §11), the fourth is the architecture document's Phase 2 go/no-go.
 * Marked `informational` so nothing in this file can quietly turn them into a
 * gate before the owner has seen a baseline.
 */
const REFERENCE_THRESHOLDS = Object.freeze([
  { key: 'routing.precision', label: 'Routing precision', target: 90, source: 'DoD (spec §11)' },
  { key: 'routing.recall', label: 'Routing recall', target: 75, source: 'DoD (spec §11)' },
  { key: 'slots.grade.valueAccuracy', label: 'Grade slot accuracy', target: 85, source: 'DoD (spec §11)' },
  {
    key: 'byLanguage.hinglish.precision',
    label: 'Hinglish precision',
    target: 85,
    source: 'Architecture — Phase 2 go/no-go',
  },
]);

const pick = (object, dotted) => dotted.split('.').reduce((node, key) => (node ? node[key] : undefined), object);

const fmt = (r) => (r == null || r.pct === null ? 'n/a' : `${r.pct.toFixed(1)}% (${r.n}/${r.of})`);

/** Escape a CSV field. */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS = [
  'case_id',
  'turn',
  'stratum',
  'language',
  'utterance',
  'expected_decision',
  'expected_action',
  'actual_decision',
  'actual_action',
  'verdict',
  'attribution',
  'ask_slot',
  'topic_verdict',
  'slots_correct',
  'slots_wrong',
  'slots_hallucinated',
  'stale_inherited',
  'passthrough_reason',
  'classifier_calls',
  'latency_ms',
];

function toCsv(scored) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const entry of scored) {
    rows.push(
      [
        entry.caseId,
        entry.turn ?? '',
        entry.stratum,
        entry.language,
        entry.utterance,
        entry.expected.decision,
        entry.expected.actionId ?? '',
        entry.actual.decision,
        entry.actual.actionId ?? '',
        entry.verdict,
        entry.attribution ?? '',
        entry.actual.askSlot ?? '',
        entry.slots.topic ?? '',
        entry.slots.stated.filter((s) => s.correct).length,
        entry.slots.stated.filter((s) => !s.correct).length,
        entry.slots.hallucinated.length,
        entry.slots.stale.length,
        entry.actual.passthroughReason ?? '',
        entry.classifierCalls,
        entry.latencyMs,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return `${rows.join('\n')}\n`;
}

function gateRow(name, gate) {
  const status = gate.pass ? 'PASS' : '**FAIL**';
  const detail = gate.pass ? '—' : gate.offenders.join(', ');
  return `| ${name} | ${status} | ${detail} |`;
}

/**
 * The human-readable summary.
 *
 * Section 10 lists EVERY failure rather than a top-N sample: at the expected
 * failure count the full list is short enough to read, and a truncated list is
 * where a systematic failure hides in the tail.
 */
function toMarkdown({ metrics, scored, meta }) {
  const gates = metrics.hardGates;
  const allGatesPass = Object.values(gates).every((gate) => gate.pass);
  const lines = [];

  lines.push(`# AI Action Router — evaluation summary`);
  lines.push('');
  lines.push(`**Hard gates: ${allGatesPass ? 'PASS' : 'FAIL'}** · mode \`${meta.mode}\` · ${metrics.totals.turns} turns scored`);
  if (meta.modelDrift) {
    lines.push('');
    lines.push(
      `> ⚠️ **MODEL DRIFT** — observed \`${meta.modelVersion}\`, baseline recorded \`${meta.baselineModelVersion}\`. ` +
        'The endpoint is a floating alias; a score change in this run may be the model moving rather than a code change.'
    );
  }
  lines.push('');
  lines.push('> Quality thresholds below are **informational**. Per the M7a authorization they are');
  lines.push('> reported and compared but do not produce a verdict until the first baseline has been');
  lines.push('> reviewed. The hard gates are safety properties and do block.');
  lines.push('');

  lines.push('## 1. Run provenance');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| mode | \`${meta.mode}\` |`);
  lines.push(`| modelVersion | \`${meta.modelVersion ?? 'n/a'}\` |`);
  lines.push(`| promptHash | \`${meta.promptHash}\` |`);
  lines.push(`| descriptorHash | \`${meta.descriptorHash}\` |`);
  lines.push(`| registryHash | \`${meta.registryHash}\` |`);
  lines.push(`| corpusHash | \`${meta.corpusHash}\` |`);
  lines.push(`| gitSha | \`${meta.gitSha ?? 'n/a'}\` |`);
  lines.push(`| repeat | ${meta.repeat ?? 1} |`);
  lines.push('');

  lines.push('## 2. Hard gates');
  lines.push('');
  lines.push('| Gate | Status | Offenders |');
  lines.push('|---|---|---|');
  lines.push(gateRow('Emergency routed', gates.emergencyRouted));
  lines.push(gateRow('Classifier calls on guarded emergency', gates.emergencyClassifierCalls));
  lines.push(gateRow('Language trap', gates.languageTrap));
  lines.push(gateRow('Out-of-catalog action accepted', gates.outOfCatalogAccepted));
  lines.push(gateRow('Ask-turn memory isolation', gates.askTurnMemoryIsolation));
  lines.push('');

  lines.push('## 3. Headline');
  lines.push('');
  lines.push('| Metric | Value | Reference | Source |');
  lines.push('|---|---|---|---|');
  for (const threshold of REFERENCE_THRESHOLDS) {
    const value = pick(metrics, threshold.key);
    lines.push(`| ${threshold.label} | ${fmt(value)} | ≥${threshold.target}% (informational) | ${threshold.source} |`);
  }
  lines.push(`| Exact decision accuracy | ${fmt(metrics.routing.decisionAccuracy)} | — | — |`);
  lines.push(`| False positives | ${metrics.falsePositives.total} | — | — |`);
  lines.push(`| False negatives | ${metrics.falseNegatives.total} | — | — |`);
  lines.push('');
  lines.push(
    `Denominators: ${metrics.totals.routed} routed, ${metrics.totals.labelledActions} labelled actions, ` +
      `${metrics.totals.ambiguousTurns} ambiguous turns quarantined.`
  );
  lines.push('');

  lines.push('## 4. By language');
  lines.push('');
  lines.push('| Language | Turns | Precision | Recall |');
  lines.push('|---|---|---|---|');
  for (const [language, block] of Object.entries(metrics.byLanguage)) {
    lines.push(`| ${language} | ${block.cases} | ${fmt(block.precision)} | ${fmt(block.recall)} |`);
  }
  lines.push('');

  lines.push('## 5. By action');
  lines.push('');
  lines.push('| Action | Precision | Recall |');
  lines.push('|---|---|---|');
  for (const [actionId, block] of Object.entries(metrics.byAction)) {
    lines.push(`| \`${actionId}\` | ${fmt(block.precision)} | ${fmt(block.recall)} |`);
  }
  lines.push('');

  lines.push('## 6. Slots');
  lines.push('');
  lines.push('| Slot | Extraction recall | Value accuracy | Hallucination |');
  lines.push('|---|---|---|---|');
  for (const [slot, block] of Object.entries(metrics.slots)) {
    const flag = block.hallucination.pct !== null && block.hallucination.pct > 0 ? ' ⚠️' : '';
    lines.push(
      `| ${slot} | ${fmt(block.extractionRecall)} | ${fmt(block.valueAccuracy)} | ${fmt(block.hallucination)}${flag} |`
    );
  }
  lines.push('');
  lines.push(
    `**Topic cleanliness** ${fmt(metrics.topic.cleanliness)} — ` +
      `exact ${metrics.topic.verdicts.exact}, dirty ${metrics.topic.verdicts.dirty}, ` +
      `crammed ${metrics.topic.verdicts.crammed}, wrong ${metrics.topic.verdicts.wrong}, ` +
      `missing ${metrics.topic.verdicts.missing}.`
  );
  lines.push('');

  lines.push('## 7. Clarification');
  lines.push('');
  lines.push(`- Rate (report-only, no threshold in Phase 1): ${fmt(metrics.clarification.rate)}`);
  lines.push(`- Correct slot asked: ${fmt(metrics.clarification.correctness)}`);
  lines.push(`- Over-asking: ${metrics.clarification.overAsking} · Under-asking: ${metrics.clarification.underAsking}`);
  lines.push('');

  lines.push('## 8. Memory');
  lines.push('');
  lines.push(`- Sessions: ${metrics.memory.sessions} (${metrics.memory.turns} turns)`);
  lines.push(`- Inheritance correctness: ${fmt(metrics.memory.inheritanceCorrectness)}`);
  lines.push(`- Staleness (lower is better): ${fmt(metrics.memory.staleness)}`);
  lines.push(`- Override correctness: ${fmt(metrics.memory.overrideCorrectness)}`);
  lines.push('');

  lines.push('## 9. False-negative attribution');
  lines.push('');
  lines.push('Code causes are listed first — anything in the first three rows is a defect in this');
  lines.push('repository, not a model-quality result, and is escalated before the numbers are discussed.');
  lines.push('');
  lines.push('| Attribution | Count | Owner |');
  lines.push('|---|---|---|');
  const ownerOf = {
    invalid_proposal: '**CODE** — proposalSchema.js',
    params_dropped: '**CODE** — resolver.js / schema',
    infra: '**CODE/OPS** — tunables, upstream',
    policy_decision: 'policy.js',
    classifier_slot_missing: 'prompt (M7b) — slot not extracted',
    classifier_slot_hallucinated: 'prompt (M7b) — slot invented',
    classifier_not_an_action: 'prompt (M7b)',
    classifier_wrong_action: 'prompt / descriptor examples',
    low_confidence: 'policy thresholds',
    emergency_shortcircuit: 'expected — safety',
    unknown: '**CODE** — unmapped reason',
  };
  const order = [
    'invalid_proposal',
    'params_dropped',
    'infra',
    'unknown',
    'policy_decision',
    'classifier_wrong_action',
    'classifier_slot_missing',
    'classifier_slot_hallucinated',
    'classifier_not_an_action',
    'low_confidence',
    'emergency_shortcircuit',
  ];
  for (const key of order) {
    const count = metrics.falseNegatives.byAttribution[key];
    if (count) lines.push(`| ${key} | ${count} | ${ownerOf[key]} |`);
  }
  lines.push('');

  lines.push('## 10. Ambiguous bucket (quarantined)');
  lines.push('');
  lines.push(`Agreement with the acceptable set: ${fmt(metrics.ambiguousBucket.agreement)}`);
  if (metrics.ambiguousBucket.outside.length > 0) {
    lines.push('');
    lines.push(`Outside the acceptable set: ${metrics.ambiguousBucket.outside.join(', ')}`);
  }
  lines.push('');

  lines.push('## 11. Every failure');
  lines.push('');
  const failures = scored.filter(
    (entry) =>
      entry.verdict !== 'correct' && entry.verdict !== 'acceptable' && entry.verdict !== 'correct_action_wrong_decision'
  );
  const softFailures = scored.filter((entry) => entry.verdict === 'correct_action_wrong_decision');
  if (failures.length === 0 && softFailures.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| Case | Expected | Actual | Verdict | Attribution |');
    lines.push('|---|---|---|---|---|');
    for (const entry of [...failures, ...softFailures]) {
      const id = entry.turn ? `${entry.caseId}#${entry.turn}` : entry.caseId;
      lines.push(
        `| \`${id}\` | ${entry.expected.decision}/${entry.expected.actionId ?? '—'} | ` +
          `${entry.actual.decision}/${entry.actual.actionId ?? '—'}${entry.actual.passthroughReason ? ` (${entry.actual.passthroughReason})` : ''} | ` +
          `${entry.verdict} | ${entry.attribution ?? '—'} |`
      );
    }
  }
  lines.push('');

  lines.push('## 12. Slot-level failures');
  lines.push('');
  const slotFailures = scored.filter(
    (entry) =>
      entry.slots.hallucinated.length > 0 ||
      entry.slots.stale.length > 0 ||
      entry.slots.stated.some((s) => !s.correct) ||
      entry.slots.inherited.some((s) => !s.correct)
  );
  if (slotFailures.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| Case | Issue |');
    lines.push('|---|---|');
    for (const entry of slotFailures) {
      const id = entry.turn ? `${entry.caseId}#${entry.turn}` : entry.caseId;
      const issues = [];
      for (const stated of entry.slots.stated.filter((s) => !s.correct)) {
        issues.push(
          `\`${stated.slot}\` expected \`${stated.expected}\`, got \`${stated.actual ?? 'nothing'}\`` +
            `${stated.provenance ? ` (${stated.provenance})` : ''}`
        );
      }
      for (const h of entry.slots.hallucinated) issues.push(`**hallucinated** \`${h.slot}\`=\`${h.actual}\``);
      for (const s of entry.slots.stale) issues.push(`**stale** \`${s.slot}\`=\`${s.actual}\``);
      for (const i of entry.slots.inherited.filter((s) => !s.correct)) {
        issues.push(`\`${i.slot}\` not inherited (expected \`${i.expected}\`, got \`${i.actual ?? 'nothing'}\` via ${i.provenance ?? 'nothing'})`);
      }
      lines.push(`| \`${id}\` | ${issues.join('; ')} |`);
    }
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

/** Write all four artifacts into a run directory. */
function writeRun({ dir, metrics, scored, meta }) {
  fs.mkdirSync(dir, { recursive: true });

  // results.json keeps the full record; the volatile meta lives in run.json.
  fs.writeFileSync(
    path.join(dir, 'results.json'),
    `${JSON.stringify({ metrics, cases: scored }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'results.csv'), toCsv(scored), 'utf8');
  fs.writeFileSync(path.join(dir, 'summary.md'), toMarkdown({ metrics, scored, meta }), 'utf8');
  fs.writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  return dir;
}

/**
 * The promoted baseline: counts only, plus the four provenance hashes.
 *
 * Counts rather than percentages, because the replay gate asserts EXACT equality
 * and a rounded percentage would let a real change hide inside the rounding.
 */
function toBaseline({ metrics, scored, meta }) {
  return {
    recordedAt: meta.startedAt,
    mode: meta.mode,
    modelVersion: meta.modelVersion,
    promptHash: meta.promptHash,
    descriptorHash: meta.descriptorHash,
    registryHash: meta.registryHash,
    corpusHash: meta.corpusHash,
    gitSha: meta.gitSha,
    counts: {
      turns: metrics.totals.turns,
      routed: metrics.totals.routed,
      labelledActions: metrics.totals.labelledActions,
      precisionHits: metrics.routing.precision.n,
      recallHits: metrics.routing.recall.n,
      exactDecisions: metrics.routing.decisionAccuracy.n,
      falsePositives: metrics.falsePositives.total,
      falseNegatives: metrics.falseNegatives.total,
      ambiguousAgreement: metrics.ambiguousBucket.agreement.n,
      topicExact: metrics.topic.verdicts.exact,
      memoryInheritanceCorrect: metrics.memory.inheritanceCorrectness.n,
      memoryStale: metrics.memory.staleness.n,
    },
    hardGates: Object.fromEntries(
      Object.entries(metrics.hardGates).map(([name, gate]) => [name, gate.pass])
    ),
    // Per-case verdicts, in corpus order. This is what lets the replay gate name
    // the case that changed instead of only reporting that a total moved — and
    // it is why a net-neutral change (one case fixed, one broken) still fails.
    verdicts: scored.map((entry) => ({
      id: entry.turn ? `${entry.caseId}#${entry.turn}` : entry.caseId,
      verdict: entry.verdict,
      decision: entry.actual.decision,
      actionId: entry.actual.actionId,
    })),
  };
}

module.exports = { REFERENCE_THRESHOLDS, CSV_COLUMNS, toCsv, toMarkdown, writeRun, toBaseline, fmt };
