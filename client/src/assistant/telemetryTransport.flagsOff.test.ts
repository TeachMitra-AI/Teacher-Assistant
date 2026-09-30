import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantEventsRequest } from './types';

// The flags-off half of the transport's contract, in its own file because the flag is a build-time constant read at module
// load (one module registry per file). It makes "flags off ⇒ no network requests, no Event rows, no background activity"
// provable for telemetry.

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  ASSISTANT_ENABLED: false,
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
  flush,
  resetTelemetryTransport,
  peekQueue,
} = await import('./telemetryTransport');
const { recordFieldCorrection } = await import('./telemetry');

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetTelemetryTransport();
  postAssistantEvents.mockClear();
});

describe('with the flag off', () => {
  it('sends nothing, for a complete session that would otherwise send two events', async () => {
    notePrefillDelivered({
      draftId: 'draft-1',
      actionId: 'generate_assessment',
      requestId: '3f1c8a2d-6b4e-4c9a-9d2f-7e5a1b3c8d40',
      fieldCount: 8,
      lowConfidenceCount: 1,
    });
    recordFieldCorrection('generate_assessment', 'grade', 'utterance');
    notePrefillGenerated();
    notePrefillUndone();
    flushOnHide();
    await flush();
    await settle();

    expect(postAssistantEvents).not.toHaveBeenCalled();
  });

  it('queues nothing either — no buffer grows in the background', async () => {
    notePrefillDelivered({
      draftId: 'draft-1',
      actionId: 'generate_assessment',
      fieldCount: 8,
      lowConfidenceCount: 0,
    });
    await settle();

    // Nothing is recorded at all, or the queue would leak memory over a long session.
    expect(peekQueue()).toHaveLength(0);
  });
});
