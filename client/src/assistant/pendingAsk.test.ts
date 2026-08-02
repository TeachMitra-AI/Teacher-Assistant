import { describe, expect, it } from 'vitest';
// The module's own source, for the CHANGE-3 no-network guard below.
import pendingAskSource from './pendingAsk.ts?raw';
import { ASK_MAX_FREE_TEXT_VALUE, completeAsk, resolveAskReply } from './pendingAsk';
import type { AskPrompt, ResolvedAction } from './types';

// Amendment CHANGE-3: answering a clarifying question costs NO network call and
// NO model call. The tests below are the evidence for that claim — nothing in
// this module can reach either, because nothing in it is async.

const formatAsk: AskPrompt = {
  slot: 'format',
  question: 'Quiz or worksheet?',
  options: [
    { label: 'Quiz', value: 'quiz' },
    { label: 'Worksheet', value: 'worksheet' },
  ],
};

const topicAsk: AskPrompt = {
  slot: 'topic',
  question: 'What topic should it cover?',
};

const gradeContradictionAsk: AskPrompt = {
  slot: 'grade',
  question: 'Which grade did you mean — Class 3-5 or Class 6-8?',
  options: [
    { label: 'Class 3-5', value: 'Class 3-5' },
    { label: 'Class 6-8', value: 'Class 6-8' },
  ],
};

function asking(ask: AskPrompt): ResolvedAction {
  return {
    actionId: 'generate_assessment',
    version: 1,
    effect: 'draft',
    decision: 'ask',
    confidence: 'high',
    params: { topic: 'Fractions', grade: 'Class 3-5', difficulty: 'medium' },
    provenance: { topic: 'utterance', grade: 'memory', difficulty: 'default' },
    missing: [ask.slot],
    lowConfidenceFields: [],
    ask,
  };
}

describe('CHANGE-3 — answering costs no network call and no model call', () => {
  it('can actually read the file it is guarding', () => {
    expect(pendingAskSource).toContain('export function completeAsk');
  });

  it('imports nothing that can reach the network', () => {
    // The amendment's whole point is that a chip tap resolves locally. An import
    // of the api wrapper here would be the change that quietly reintroduces a
    // second round trip on a low-end device.
    expect(pendingAskSource).not.toMatch(/from '\.\/api'/);
    expect(pendingAskSource).not.toContain('postInterpret');
    expect(pendingAskSource).not.toContain('fetch(');
  });

  it('exposes only synchronous functions, so there is nothing to await', () => {
    expect(pendingAskSource).not.toContain('async ');
    expect(pendingAskSource).not.toContain('await ');
  });
});

describe('resolveAskReply — a question with options', () => {
  it('matches an option by its value', () => {
    expect(resolveAskReply(formatAsk, 'worksheet')).toBe('worksheet');
  });

  it('matches an option by its label, so typing equals tapping', () => {
    expect(resolveAskReply(formatAsk, 'Worksheet')).toBe('worksheet');
  });

  it('is insensitive to case, padding and internal spacing', () => {
    expect(resolveAskReply(formatAsk, '  QUIZ  ')).toBe('quiz');
    expect(resolveAskReply(gradeContradictionAsk, 'class 3-5')).toBe('Class 3-5');
    expect(resolveAskReply(gradeContradictionAsk, 'Class  3-5')).toBe('Class 3-5');
  });

  it('returns null for a reply that answers a different question', () => {
    // The teacher has moved on; this is a new message, not an answer.
    expect(resolveAskReply(formatAsk, 'actually explain photosynthesis instead')).toBeNull();
    expect(resolveAskReply(formatAsk, 'test paper')).toBeNull();
  });

  it('returns the offered VALUE, never the label the teacher typed', () => {
    // policy.js labels a language contradiction with codes and lets the client
    // display its own words — but the value sent back must be the offered one.
    const languageAsk: AskPrompt = {
      slot: 'language',
      question: 'Which language did you mean — hi or en?',
      options: [
        { label: 'hi', value: 'hi' },
        { label: 'en', value: 'en' },
      ],
    };
    expect(resolveAskReply(languageAsk, 'HI')).toBe('hi');
  });
});

describe('resolveAskReply — an open question', () => {
  it('takes the reply itself as the value', () => {
    // Without this a `topic` ask would dead-end: "fractions" carries no
    // imperative verb, so re-classifying it would fail the intent gate and the
    // teacher would get a coaching answer to a question they never asked.
    expect(resolveAskReply(topicAsk, 'photosynthesis')).toBe('photosynthesis');
    expect(resolveAskReply(topicAsk, '  the water cycle  ')).toBe('the water cycle');
  });

  it('refuses a reply too long to be a slot value', () => {
    const essay = 'a'.repeat(ASK_MAX_FREE_TEXT_VALUE + 1);
    expect(resolveAskReply(topicAsk, essay)).toBeNull();
  });

  it('accepts a reply exactly at the bound', () => {
    const exact = 'a'.repeat(ASK_MAX_FREE_TEXT_VALUE);
    expect(resolveAskReply(topicAsk, exact)).toBe(exact);
  });
});

describe('resolveAskReply — defensive', () => {
  it('returns null for an empty or whitespace-only reply', () => {
    expect(resolveAskReply(formatAsk, '')).toBeNull();
    expect(resolveAskReply(topicAsk, '   ')).toBeNull();
  });

  it('returns null when there is no question', () => {
    expect(resolveAskReply(undefined, 'worksheet')).toBeNull();
  });

  it('returns null for a non-string reply without throwing', () => {
    expect(resolveAskReply(formatAsk, null as unknown as string)).toBeNull();
  });
});

describe('completeAsk', () => {
  it('fills the slot and promotes the decision to prefill', () => {
    const completed = completeAsk(asking(formatAsk), 'worksheet');

    expect(completed.decision).toBe('prefill');
    expect(completed.params.format).toBe('worksheet');
    expect(completed.missing).toEqual([]);
    expect(completed.ask).toBeUndefined();
  });

  it('attributes the answer to the utterance, not to a manual edit (decision D4)', () => {
    // 'user' would leave an unmarked value that "Clear AI fields" deliberately
    // skips, stranding it in the form after the teacher rejected everything
    // around it.
    expect(completeAsk(asking(formatAsk), 'quiz').provenance.format).toBe('utterance');
  });

  it('leaves every other parameter and its provenance untouched', () => {
    const completed = completeAsk(asking(formatAsk), 'quiz');
    expect(completed.params.topic).toBe('Fractions');
    expect(completed.params.grade).toBe('Class 3-5');
    expect(completed.provenance.grade).toBe('memory');
    expect(completed.provenance.difficulty).toBe('default');
  });

  it('cannot escalate the decision beyond prefill', () => {
    // Completing a slot may only move ask → prefill. There is no input to this
    // function that produces 'execute'.
    for (const value of ['quiz', 'worksheet', '', 'execute']) {
      expect(completeAsk(asking(formatAsk), value).decision).toBe('prefill');
    }
  });

  it('does not mutate the pending action', () => {
    const pending = asking(formatAsk);
    completeAsk(pending, 'worksheet');

    expect(pending.decision).toBe('ask');
    expect(pending.params.format).toBeUndefined();
    expect(pending.missing).toEqual(['format']);
    expect(pending.ask).toBeDefined();
  });

  it('answers a contradiction with one of the readings that were offered', () => {
    const completed = completeAsk(asking(gradeContradictionAsk), 'Class 6-8');
    expect(completed.params.grade).toBe('Class 6-8');
    expect(completed.provenance.grade).toBe('utterance');
    expect(completed.decision).toBe('prefill');
  });

  it('degrades to a plain prefill when the action carries no question', () => {
    const withoutAsk = { ...asking(formatAsk), ask: undefined };
    const completed = completeAsk(withoutAsk, 'worksheet');
    expect(completed.decision).toBe('prefill');
    expect(completed.params.format).toBeUndefined();
  });
});
