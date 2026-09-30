import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantEvent, AssistantEventsRequest } from './types';

// The ≤2-rows-per-session ceiling is enforced here, not on the server, which can only refuse what it's sent. It's proven
// by counting events over whole simulated sessions. The flag is a build-time constant read at load, so it's stubbed
// before importing the module.

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  ASSISTANT_ENABLED: true,
}));

const postAssistantEvents = vi.fn(async (_body: AssistantEventsRequest): Promise<boolean> => true);
vi.mock('./api', () => ({
  postAssistantEvents: (body: AssistantEventsRequest) => postAssistantEvents(body),
}));

const {
  notePrefillDelivered,
  notePrefillGenerated,
  notePrefillUndone,
  flushOnHide,
  resetTelemetryTransport,
  simulateReload,
  peekQueue,
} = await import('./telemetryTransport');
const { recordFieldCorrection } = await import('./telemetry');

/** Let the transport's drain loop run to completion. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Every event sent across every batch, in order. */
function sentEvents(): AssistantEvent[] {
  return postAssistantEvents.mock.calls.flatMap((call) => call[0].events);
}

const DELIVERY = {
  draftId: 'draft-1',
  actionId: 'generate_assessment',
  requestId: '3f1c8a2d-6b4e-4c9a-9d2f-7e5a1b3c8d40',
  fieldCount: 8,
  lowConfidenceCount: 1,
};

beforeEach(() => {
  resetTelemetryTransport();
  postAssistantEvents.mockClear();
});

describe('the two-rows-per-session ceiling', () => {
  it('sends exactly two events for a session with six corrections', async () => {
    // Six corrections must not become six events.
    notePrefillDelivered(DELIVERY);
    for (const field of ['grade', 'subject', 'topic', 'format', 'difficulty', 'language']) {
      recordFieldCorrection('generate_assessment', field, 'utterance');
    }
    notePrefillGenerated();
    await settle();

    const events = sentEvents();
    expect(events).toHaveLength(2);
    expect(events[0].name).toBe('prefill_delivered');
    expect(events[1].name).toBe('prefill_outcome');
  });

  it('collapses the corrections into the outcome event', async () => {
    notePrefillDelivered(DELIVERY);
    recordFieldCorrection('generate_assessment', 'grade', 'utterance');
    recordFieldCorrection('generate_assessment', 'topic', 'memory');
    notePrefillGenerated();
    await settle();

    const outcome = sentEvents().find((e) => e.name === 'prefill_outcome');
    expect(outcome?.corrections).toEqual([
      { field: 'grade', from: 'utterance' },
      { field: 'topic', from: 'memory' },
    ]);
  });

  it('latches the outcome — a regenerate cannot produce a second one', async () => {
    notePrefillDelivered(DELIVERY);
    notePrefillGenerated();
    notePrefillGenerated();
    notePrefillGenerated();
    await settle();

    expect(sentEvents().filter((e) => e.name === 'prefill_outcome')).toHaveLength(1);
  });

  it('latches across DIFFERENT outcomes too', async () => {
    // Would otherwise write three rows: edit a field, tab away (edited), come back, press Generate (generated).
    notePrefillDelivered(DELIVERY);
    recordFieldCorrection('generate_assessment', 'grade', 'utterance');
    flushOnHide();
    notePrefillGenerated();
    await settle();

    expect(sentEvents()).toHaveLength(2);
  });

  it('does not re-count a delivery for the same draft', async () => {
    notePrefillDelivered(DELIVERY);
    notePrefillDelivered(DELIVERY);
    await settle();

    expect(sentEvents().filter((e) => e.name === 'prefill_delivered')).toHaveLength(1);
  });

  it('does not re-count a delivery for the same draft across a hard refresh (bug fix)', async () => {
    // A hard refresh reset the in-memory delivery latch while the same `?ai=` draft was still live, so the delivery was
    // reported twice. `simulateReload` reproduces the state a refresh leaves: latch gone, sessionStorage intact.
    notePrefillDelivered(DELIVERY);
    await settle();
    simulateReload();
    notePrefillDelivered(DELIVERY);
    await settle();

    expect(sentEvents().filter((e) => e.name === 'prefill_delivered')).toHaveLength(1);
  });

  it('still counts a delivery for a genuinely DIFFERENT draft after a refresh', async () => {
    // Must not overcorrect into refusing every delivery after a refresh, only the same draft id.
    notePrefillDelivered(DELIVERY);
    await settle();
    simulateReload();
    notePrefillDelivered({ ...DELIVERY, draftId: 'draft-2' });
    await settle();

    expect(sentEvents().filter((e) => e.name === 'prefill_delivered')).toHaveLength(2);
  });
});

describe('outcomes', () => {
  it('reports undone', async () => {
    notePrefillDelivered(DELIVERY);
    notePrefillUndone();
    await settle();

    const outcome = sentEvents().find((e) => e.name === 'prefill_outcome');
    expect(outcome?.outcome).toBe('undone');
  });

  it('reports edited when a second draft closes an unfinished session', async () => {
    notePrefillDelivered(DELIVERY);
    recordFieldCorrection('generate_assessment', 'grade', 'utterance');

    // Routed again without generating.
    notePrefillDelivered({ ...DELIVERY, draftId: 'draft-2' });
    await settle();

    const outcomes = sentEvents().filter((e) => e.name === 'prefill_outcome');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('edited');
  });

  it('stays SILENT when a prefill is abandoned untouched', async () => {
    // Abandonment is reported by absence; the server derives it from a delivery with no outcome.
    notePrefillDelivered(DELIVERY);
    flushOnHide();
    await settle();

    expect(sentEvents().filter((e) => e.name === 'prefill_outcome')).toHaveLength(0);
    expect(sentEvents().filter((e) => e.name === 'prefill_delivered')).toHaveLength(1);
  });

  it('ignores an outcome with no session behind it', async () => {
    notePrefillGenerated();
    notePrefillUndone();
    await settle();

    expect(sentEvents()).toHaveLength(0);
  });
});

describe('privacy — G11', () => {
  it('carries no teacher content in any sent event', async () => {
    notePrefillDelivered(DELIVERY);
    recordFieldCorrection('generate_assessment', 'topic', 'utterance');
    notePrefillGenerated();
    await settle();

    const serialized = JSON.stringify(sentEvents());
    for (const text of ['Fractions', 'Class 5', 'Generate a Class 5 fractions worksheet']) {
      expect(serialized).not.toContain(text);
    }
  });

  it('sends only keys from the declared wire shape', async () => {
    notePrefillDelivered(DELIVERY);
    notePrefillGenerated();
    await settle();

    const allowed = [
      'name',
      'actionId',
      'requestId',
      'fieldCount',
      'lowConfidenceCount',
      'outcome',
      'corrections',
    ];
    for (const event of sentEvents()) {
      for (const key of Object.keys(event)) expect(allowed).toContain(key);
    }
  });

  it('omits requestId entirely when there is none to join on', async () => {
    // A repeat-cache replay has no correlation id, and an empty string would fail the server's UUID check and lose the batch.
    notePrefillDelivered({ ...DELIVERY, requestId: undefined });
    await settle();

    expect(sentEvents()[0]).not.toHaveProperty('requestId');
  });
});

describe('failure posture', () => {
  it('drops a failed batch instead of retrying it', async () => {
    postAssistantEvents.mockResolvedValueOnce(false);

    notePrefillDelivered(DELIVERY);
    await settle();
    notePrefillGenerated();
    await settle();

    // The failed send is simply gone; a retry loop behind a teacher's form is worse than a lost row.
    expect(postAssistantEvents).toHaveBeenCalledTimes(2);
    expect(peekQueue()).toHaveLength(0);
  });

  it('never throws when the transport rejects', async () => {
    postAssistantEvents.mockRejectedValueOnce(new Error('offline'));

    expect(() => notePrefillDelivered(DELIVERY)).not.toThrow();
    await settle();
  });
});
