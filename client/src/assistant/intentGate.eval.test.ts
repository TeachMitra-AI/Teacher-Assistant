/// <reference types="vite/client" />

// Client intent-gate evaluation. Measures what the server-side eval can't see: what the precision-first gate refuses
// before any request is made. It reads the same jsonl corpus as the server runner (server/evals/corpus/) rather than a
// copy or a second gate implementation. Test-only file read; the client build doesn't depend on server/.

import { describe, expect, test } from 'vitest';

import { isCommand } from './intentGate';

// Vite glob instead of node:fs, so this file type-checks without @types/node (which the client deliberately doesn't have).
const CORPUS_FILES = import.meta.glob('../../../server/evals/corpus/*.jsonl', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

/** Loads every labelled turn, single and multi-turn. Throws on an empty read, since scoring nothing would look like a perfect run. */
function loadTurns(): Turn[] {
  const files = Object.keys(CORPUS_FILES).sort();
  if (files.length === 0) throw new Error('No corpus files found in server/evals/corpus');

  const turns: Turn[] = [];
  for (const file of files) {
    const lines = CORPUS_FILES[file]
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

// Ambiguous cases are quarantined so they can't move a headline number.
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

    // The declined-but-labelled-action list is the point of this file: the measured cost of the precision-first gate.
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

    // A pinned baseline, not a threshold. Loose floors (precision > 70, recall > 50) caught nothing: widening
    // PROXIMITY_TOKENS from 6 to 30 only moved precision 96.1% -> 95.2%. Pinning the counts asserts the gate does
    // what it did when measured; a deliberate gate change re-promotes these numbers in the same commit.
    expect({ referred: referred.length, truePositives, actions: actions.length }).toEqual({
      referred: 102,
      truePositives: 98,
      actions: 106,
    });
  });

  // Devanagari uses combining marks and an earlier tokenizer split every Hindi phrase into fragments; only a Hindi test caught it.
  test('Devanagari commands are still reachable at all', () => {
    const devanagariActions = actions.filter((turn) => /[ऀ-ॿ]/.test(turn.utterance));
    expect(devanagariActions.length).toBeGreaterThan(0);
    const referredCount = devanagariActions.filter((turn) => isCommand(turn.utterance)).length;
    expect(referredCount).toBeGreaterThan(0);
  });

  test('the two deliberately gate-defeating coaching cases do reach the server', () => {
    // If the gate starts declining these, the coaching stratum stops measuring the classifier and measures the gate.
    for (const id of ['coach.en.012', 'coach.en.022']) {
      const turn = turns.find((candidate) => candidate.id === id);
      expect(turn, `${id} missing from the corpus`).toBeDefined();
      expect(isCommand(turn!.utterance), `${id} should defeat the gate`).toBe(true);
    }
  });

  test('emergency utterances are not the gate\'s job, and it does not pretend otherwise', () => {
    // Recorded, not asserted: the gate has no emergency vocabulary and shouldn't grow one; the server short-circuits it first.
    const emergencies = turns.filter((turn) => turn.stratum === 'emergency');
    const referredEmergencies = emergencies.filter((turn) => isCommand(turn.utterance));
    expect(emergencies.length).toBeGreaterThanOrEqual(10);
    console.log(`emergency utterances referred by the gate: ${referredEmergencies.length}/${emergencies.length}`);
  });
});
