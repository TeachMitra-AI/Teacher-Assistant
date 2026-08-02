import { beforeEach, describe, expect, it } from 'vitest';
import { coercePrefillValues, loadPrefill } from './generatorPrefill';
import { createDraft, markConsumed, DRAFT_STORAGE_KEY } from './draftStore';
import { drainTelemetry } from './telemetry';

// coercePrefillValues is the boundary between an untrusted params object and
// the Generator's typed form state. Everything it rejects is a field the
// teacher then sees at its normal default — which is the correct outcome, and
// far better than a form confidently showing a value the endpoint would reject.

beforeEach(() => {
  window.sessionStorage.clear();
  drainTelemetry();
});

describe('coercePrefillValues', () => {
  it('accepts a fully-populated, valid params object', () => {
    expect(
      coercePrefillValues({
        format: 'worksheet',
        topic: 'Fractions',
        grade: 'Class 3-5',
        subject: 'Mathematics',
        difficulty: 'medium',
        questionType: 'mcq',
        questionCount: 10,
        language: 'en',
      }),
    ).toEqual({
      format: 'worksheet',
      topic: 'Fractions',
      grade: 'Class 3-5',
      subject: 'Mathematics',
      difficulty: 'medium',
      questionType: 'mcq',
      questionCount: 10,
      language: 'en',
    });
  });

  it('applies a partial params object without inventing the rest', () => {
    // Missing fields must stay missing so the page falls back to its own
    // defaults, rather than this module guessing at them.
    expect(coercePrefillValues({ format: 'quiz', topic: 'Photosynthesis' })).toEqual({
      format: 'quiz',
      topic: 'Photosynthesis',
    });
  });

  it.each([
    ['a value outside the enum', { format: 'test paper' }],
    ['a difficulty outside the enum', { difficulty: 'impossible' }],
    ['a question type outside the enum', { questionType: 'essay' }],
    ['a non-string topic', { topic: 42 }],
    ['a whitespace-only topic', { topic: '   ' }],
    ['a non-numeric question count', { questionCount: '10' }],
    ['a fractional question count', { questionCount: 10.5 }],
  ])('drops %s', (_label, params) => {
    expect(coercePrefillValues(params)).toEqual({});
  });

  it('drops an out-of-range question count rather than clamping it', () => {
    // Clamping would silently turn "500 questions" into 30 and look like the
    // router understood the request. Dropping leaves the form's own default.
    expect(coercePrefillValues({ questionCount: 500 })).toEqual({});
    expect(coercePrefillValues({ questionCount: 1 })).toEqual({});
    expect(coercePrefillValues({ questionCount: 30 })).toEqual({ questionCount: 30 });
    expect(coercePrefillValues({ questionCount: 3 })).toEqual({ questionCount: 3 });
  });

  it('keeps the valid fields of a partly-invalid params object', () => {
    // A stale PWA client reading a newer draft must get the fields it
    // understands, not an empty form.
    expect(coercePrefillValues({ format: 'quiz', difficulty: 'brutal', topic: 'Algebra' })).toEqual({
      format: 'quiz',
      topic: 'Algebra',
    });
  });

  it('ignores unrecognised keys entirely', () => {
    // Notably `instructions`, which is deliberately not a router slot, and any
    // field a future build might add.
    expect(coercePrefillValues({ topic: 'Verbs', instructions: 'be creative', futureField: true })).toEqual({
      topic: 'Verbs',
    });
  });

  it('trims and bounds free text', () => {
    const result = coercePrefillValues({ topic: `  ${'x'.repeat(300)}  ` });
    expect(result.topic).toHaveLength(200);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nonsense'],
    ['an array', []],
  ])('returns nothing for %s', (_label, params) => {
    expect(coercePrefillValues(params)).toEqual({});
  });
});

describe('loadPrefill', () => {
  const draftInput = {
    actionId: 'generate_assessment',
    version: 1,
    initialParams: { format: 'worksheet' as const, topic: 'Fractions', questionCount: 10 },
    provenance: { format: 'utterance' as const, topic: 'utterance' as const, questionCount: 'default' as const },
    lowConfidenceFields: [] as string[],
    utterance: 'Generate a Class 5 fractions worksheet',
  };

  it('returns values, provenance and the utterance for a valid draft', () => {
    const id = createDraft(draftInput)!;
    const prefill = loadPrefill(id)!;

    expect(prefill.values).toEqual({ format: 'worksheet', topic: 'Fractions', questionCount: 10 });
    expect(prefill.provenance).toEqual({ format: 'utterance', topic: 'utterance', questionCount: 'default' });
    expect(prefill.utterance).toBe('Generate a Class 5 fractions worksheet');
  });

  it('records the prefill so the field-edit rate has a denominator', () => {
    const id = createDraft({ ...draftInput, lowConfidenceFields: ['grade'] })!;
    loadPrefill(id);

    const [event] = drainTelemetry();
    expect(event).toMatchObject({ name: 'prefill_applied', fieldCount: 3 });
  });

  it.each([
    ['an empty handle', () => ''],
    ['an unknown handle', () => 'no-such-draft'],
  ])('returns null for %s', (_label, getId) => {
    createDraft(draftInput);
    expect(loadPrefill(getId())).toBeNull();
  });

  it('returns null for a consumed draft', () => {
    const id = createDraft(draftInput)!;
    markConsumed(id);
    expect(loadPrefill(id)).toBeNull();
  });

  it('returns null for a draft belonging to a different action', () => {
    // open_generator navigates but prefills nothing. Applying its params here
    // would be the router filling a form it was never asked to fill.
    const id = createDraft({ ...draftInput, actionId: 'open_generator' })!;
    expect(loadPrefill(id)).toBeNull();
  });

  it('returns null when no field survives coercion', () => {
    const id = createDraft({ ...draftInput, initialParams: { format: 'nonsense', questionCount: 900 } })!;
    expect(loadPrefill(id)).toBeNull();
  });

  it('emits no telemetry when there is nothing to apply', () => {
    loadPrefill('no-such-draft');
    expect(drainTelemetry()).toHaveLength(0);
  });

  it('marks provenance only for fields it actually applied', () => {
    const id = createDraft({
      ...draftInput,
      initialParams: { topic: 'Fractions', difficulty: 'brutal' },
      provenance: { topic: 'utterance' as const, difficulty: 'utterance' as const },
    })!;

    const prefill = loadPrefill(id)!;
    expect(Object.keys(prefill.provenance)).toEqual(['topic']);
  });

  it('drops low-confidence markers for fields it did not apply', () => {
    const id = createDraft({ ...draftInput, lowConfidenceFields: ['grade', 'topic'] })!;
    expect(loadPrefill(id)!.lowConfidenceFields).toEqual(['topic']);
  });

  it('labels an applied field with unknown provenance as inferred', () => {
    // Reachable only from a hand-written draft. "We don't know" is the honest
    // label; silently claiming 'utterance' would corrupt the correction metric.
    window.sessionStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'handwritten',
          actionId: 'generate_assessment',
          initialParams: { topic: 'Photosynthesis' },
          expiresAt: Date.now() + 60_000,
        },
      ]),
    );

    expect(loadPrefill('handwritten')!.provenance).toEqual({ topic: 'inferred' });
  });
});
