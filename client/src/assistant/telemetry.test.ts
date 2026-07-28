import { beforeEach, describe, expect, it } from 'vitest';
import {
  drainTelemetry,
  recordFieldCorrection,
  recordPrefillApplied,
  recordUndoAll,
} from './telemetry';

// Two things are worth testing here, and only two.
//
// 1. The events needed to compute the field-edit rate are actually produced —
//    it is the launch gate, and a metric that silently records nothing is worse
//    than no metric, because it reads as success.
// 2. Nothing a teacher wrote can end up in an event (guardrail G11).

beforeEach(() => {
  drainTelemetry();
});

describe('event recording', () => {
  it('records a prefill as the field-edit rate denominator', () => {
    recordPrefillApplied('generate_assessment', 8, 1);

    const events = drainTelemetry();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'prefill_applied',
      actionId: 'generate_assessment',
      fieldCount: 8,
      lowConfidenceCount: 1,
    });
  });

  it('records a correction with the field name and its previous provenance', () => {
    recordFieldCorrection('generate_assessment', 'grade', 'utterance');

    const [event] = drainTelemetry();
    expect(event).toMatchObject({ name: 'field_corrected', field: 'grade', from: 'utterance' });
  });

  it('records an undo with the number of fields reset', () => {
    recordUndoAll('generate_assessment', 6);

    const [event] = drainTelemetry();
    expect(event).toMatchObject({ name: 'undo_all', fieldCount: 6 });
  });

  it('yields both halves of the field-edit rate from one session', () => {
    recordPrefillApplied('generate_assessment', 8, 0);
    recordFieldCorrection('generate_assessment', 'topic', 'utterance');
    recordFieldCorrection('generate_assessment', 'grade', 'profile');

    const events = drainTelemetry();
    const denominator = events.find((e) => e.name === 'prefill_applied')!.fieldCount!;
    const numerator = events.filter((e) => e.name === 'field_corrected').length;

    expect(numerator / denominator).toBeCloseTo(0.25);
  });

  it('stamps every event with a time', () => {
    recordPrefillApplied('generate_assessment', 8, 0);
    expect(drainTelemetry()[0].at).toBeGreaterThan(0);
  });
});

describe('privacy', () => {
  it('carries no teacher-authored content in any event', () => {
    // The call sites pass a slot NAME and a provenance SOURCE. There is no
    // parameter that could carry a topic, a grade value, or the utterance —
    // the guarantee is structural, and this asserts the serialized result.
    recordPrefillApplied('generate_assessment', 8, 1);
    recordFieldCorrection('generate_assessment', 'topic', 'utterance');
    recordUndoAll('generate_assessment', 8);

    const serialized = JSON.stringify(drainTelemetry());
    for (const teacherText of ['Fractions', 'Class 5', 'Generate a Class 5 fractions worksheet']) {
      expect(serialized).not.toContain(teacherText);
    }
  });

  it('only ever contains keys from the declared event shape', () => {
    recordFieldCorrection('generate_assessment', 'grade', 'memory');

    const allowed = ['name', 'actionId', 'field', 'from', 'fieldCount', 'lowConfidenceCount', 'at'];
    for (const key of Object.keys(drainTelemetry()[0])) {
      expect(allowed).toContain(key);
    }
  });
});

describe('buffer management', () => {
  it('empties on drain so an event is delivered exactly once', () => {
    recordPrefillApplied('generate_assessment', 8, 0);
    expect(drainTelemetry()).toHaveLength(1);
    expect(drainTelemetry()).toHaveLength(0);
  });

  it('stays bounded under a long session, keeping the newest events', () => {
    for (let i = 0; i < 120; i += 1) recordFieldCorrection('generate_assessment', `field_${i}`, 'default');

    const events = drainTelemetry();
    expect(events.length).toBeLessThanOrEqual(50);
    expect(events[events.length - 1].field).toBe('field_119');
  });
});
