// Client intent-gate evaluation (AI Action Router milestone M7a).
//
// Measures the ONE thing the server-side eval structurally cannot see: what the
// precision-first gate refuses before any request is made. `intentGate.ts` says
// so itself — "the recall gap this leaves is REAL and deliberately unmeasured
// here. M7's eval corpus measures it against labelled utterances." This is that
// measurement.
//
// ─── ONE CORPUS, NO SECOND IMPLEMENTATION ──────────────────────────────────
// The corpus is DATA (jsonl), so this file reads the very same labels the server
// runner reads, from `server/evals/corpus/`. The alternative — copying the
// corpus into client/ behind a drift guard — would make a fifth home for
// knowledge this project has already resolved to stop duplicating (README §12
// scalability risks, and folder-README rule 9). Porting `isCommand` into the
// server runner would be worse still: a second implementation of the gate is
// precisely what the guardrails forbid.
//
// This is a TEST-ONLY file read. It never enters the bundle, and the client
// build does not depend on `server/` existing.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { isCommand } from './intentGate';

const CORPUS_DIR = join(__dirname, '..', '..', '..', 'server', 'evals', 'corpus');

type Expected = {
  decision: 'prefill' | 'ask' | 'passthrough';
  acceptable?: string[];
  actionId: string | null;
};

type Turn = {
  id: string;
  stratum: string;
  language: string;
  utterance: string;
  expected: Expected;
};

/**
 * Load every labelled turn, single and multi-turn alike.
 *
 * Fails loudly on an empty read, exactly as the server loader does. A gate eval
 * that silently scores nothing would report a perfect 100% and be
 * indistinguishable from a working one.
 */
function loadTurns(): Turn[] {
  const files = readdirSync(CORPUS_DIR).filter((name) => name.endsWith('.jsonl')).sort();
  if (files.length === 0) throw new Error(`No corpus files in ${CORPUS_DIR}`);

  const turns: Turn[] = [];
  for (const file of files) {
    const lines = readFileSync(join(CORPUS_DIR, file), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'));

    for (const line of lines) {
      const record = JSON.parse(line);
      if (Array.isArray(record.turns)) {
        record.turns.forEach((turn: { utterance: string; expected: Expected }, index: number) => {
          turns.push({
            id: `${record.id}#${index + 1}`,
            stratum: 'memory',
            language: record.language,
            utterance: turn.utterance,
            expected: turn.expected,
          });
        });
      } else {
        turns.push(record as Turn);
      }
    }
  }
  return turns;
}

const turns = loadTurns();
const isAction = (turn: Turn) => turn.expected.decision !== 'passthrough' && turn.expected.actionId !== null;

// Ambiguous cases are quarantined here for the same reason they are on the
// server: they cannot be allowed to move a headline number.
const headline = turns.filter((turn) => turn.stratum !== 'ambiguous');
const referred = headline.filter((turn) => isCommand(turn.utterance));
const actions = headline.filter(isAction);

const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 1000) / 10);

describe('intent gate — corpus evaluation', () => {
  test('the corpus actually loaded', () => {
    expect(turns.length).toBeGreaterThanOrEqual(120);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('reports gate precision and recall', () => {
    const truePositives = referred.filter(isAction).length;
    const recalled = actions.filter((turn) => isCommand(turn.utterance)).length;

    const precision = pct(truePositives, referred.length);
    const recall = pct(recalled, actions.length);

    // The declined-but-labelled-action list IS the deliverable of this file: it
    // is the measured cost of CHANGE-2's precision-first bet, case by case.
    const declined = actions.filter((turn) => !isCommand(turn.utterance));

    console.log(
      [
        '',
        `gate precision  ${precision}% (${truePositives}/${referred.length})`,
        `gate recall     ${recall}% (${recalled}/${actions.length})`,
        `declined but labelled as actions: ${declined.length}`,
        ...declined.map((turn) => `  - ${turn.id} [${turn.language}] ${turn.utterance}`),
        '',
      ].join('\n')
    );

    // A PINNED BASELINE, NOT A THRESHOLD.
    //
    // This started life as two loose floors (precision > 70, recall > 50) and an
    // injected-defect proof showed they caught nothing: widening PROXIMITY_TOKENS
    // from 6 to 30 moved precision only 96.1% -> 95.2% and passed both floors,
    // even though it is a real behavioural change to the gate.
    //
    // Pinning the COUNTS is the fix that stays compatible with the M7a rule that
    // quality thresholds remain informational until the baseline is reviewed:
    // this asserts "the gate does exactly what it did when measured", not "the
    // gate is good enough". Any deliberate gate change re-promotes these three
    // numbers in the same commit — the same contract the server's baseline.json
    // has, for the same reason.
    expect({ referred: referred.length, truePositives, actions: actions.length }).toEqual({
      referred: 102,
      truePositives: 98,
      actions: 106,
    });
  });

  // Devanagari is written with combining marks, and M6 found a tokenizer that
  // silently split every Hindi phrase into fragments matching nothing. No test
  // written only in English would have noticed, so this one is written in Hindi.
  test('Devanagari commands are still reachable at all', () => {
    const devanagariActions = actions.filter((turn) => /[ऀ-ॿ]/.test(turn.utterance));
    expect(devanagariActions.length).toBeGreaterThan(0);
    const referredCount = devanagariActions.filter((turn) => isCommand(turn.utterance)).length;
    expect(referredCount).toBeGreaterThan(0);
  });

  test('the two deliberately gate-defeating coaching cases do reach the server', () => {
    // If the gate ever starts declining these, the coaching stratum silently
    // stops measuring the classifier's passthrough behaviour and starts
    // measuring the gate again.
    for (const id of ['coach.en.012', 'coach.en.022']) {
      const turn = turns.find((candidate) => candidate.id === id);
      expect(turn, `${id} missing from the corpus`).toBeDefined();
      expect(isCommand(turn!.utterance), `${id} should defeat the gate`).toBe(true);
    }
  });

  test('emergency utterances are not the gate\'s job, and it does not pretend otherwise', () => {
    // Recorded rather than asserted-against: the gate has no emergency
    // vocabulary and must not grow one. The short-circuit is stage 6 on the
    // SERVER, which runs before the classifier and is proven by call count.
    const emergencies = turns.filter((turn) => turn.stratum === 'emergency');
    const referredEmergencies = emergencies.filter((turn) => isCommand(turn.utterance));
    expect(emergencies.length).toBeGreaterThanOrEqual(10);
    console.log(`emergency utterances referred by the gate: ${referredEmergencies.length}/${emergencies.length}`);
  });
});
