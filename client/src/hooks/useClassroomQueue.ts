import { useCallback, useEffect, useRef, useState } from 'react';
import {
  artifactForFormat,
  assessmentSetInputFor,
  buildableFrom,
  generateArtifact,
  loadStoredArtifacts,
  storeArtifacts,
  type StoredArtifacts,
} from '../lib/classroom';
import { generateAssessmentSet } from '../lib/resources';
import { ApiError } from '../api';
import type { ClassroomArtifact, ClassroomPlan } from '../types';

// The generation queue behind a Classroom Mode turn (docs/classroom-mode.md). Reports each artifact's state independently
// and can be stopped; the cards hold no generation logic. At most two calls are in flight per turn by construction: the four
// question-shaped artifacts go in one batched request and the lesson plan in another, so there's no worker pool.

export type ArtifactStatus = 'waiting' | 'generating' | 'ready' | 'failed' | 'stopped';

export interface ArtifactState {
  artifact: ClassroomArtifact;
  status: ArtifactStatus;
  content?: string;
  error?: string;
}

export interface ClassroomQueue {
  items: ArtifactState[];
  running: boolean;
  stop: () => void;
  retry: (artifact: ClassroomArtifact) => void;
}

/**
 * @param plan the server's plan for this turn, or null/undefined when Classroom Mode didn't run.
 * @param restored true when the plan came from history rather than the turn that just ran. Without it, opening an old chat
 *   would regenerate the whole set (four model calls per chat against the free tier's 20/minute). Restored plans render
 *   their cards `stopped`, and the teacher presses Generate on the ones they want.
 */
export function useClassroomQueue(
  plan: ClassroomPlan | null | undefined,
  restored = false,
  queryId?: string
): ClassroomQueue {
  const [items, setItems] = useState<ArtifactState[]>([]);

  // Latest items, readable from async work without making every callback depend on the state it replaces.
  const latest = useRef<ArtifactState[]>([]);
  latest.current = items;

  // Read inside async work to decide whether a result is still wanted; flipped by stop() and unmount.
  const cancelled = useRef(false);
  // Guards against a second run for the same plan: React may re-run effects (StrictMode in development), which would pay for every generation twice.
  const startedFor = useRef<ClassroomPlan | null>(null);

  // Keyed on the plan's identity, which is stable per turn (it comes from turn.response). Keying on the topic would re-fire
  // when two consecutive questions share one.
  useEffect(() => {
    // Un-cancel first, before the dedupe guard. StrictMode runs the effect, its cleanup (cancelled = true), then the effect
    // again; if the guard returned early, run 1's in-flight generations would see `cancelled`, discard their results and every
    // card would stick at "Creating…" while the requests succeed. Resetting here lets the re-run adopt the running workers.
    // On a real unmount nothing re-runs, so the cancellation stands.
    cancelled.current = false;

    if (!plan || startedFor.current === plan) return;
    startedFor.current = plan;

    const artifacts = buildableFrom(plan);
    if (artifacts.length === 0) {
      setItems([]);
      return;
    }

    // A plan restored from history renders its cards idle and spends nothing; `stopped` already means "planned, not generated".
    if (restored) {
      // Idle first so the cards appear immediately; anything previously generated then fills in.
      setItems(artifacts.map((artifact) => ({ artifact, status: 'stopped' as const })));

      if (queryId) {
        loadStoredArtifacts(queryId)
          .then((stored) => {
            if (cancelled.current) return;
            setItems((prev) =>
              prev.map((i) =>
                stored[i.artifact]
                  ? { ...i, status: 'ready' as const, content: stored[i.artifact] }
                  : i
              )
            );
          })
          // Nothing stored, or the fetch failed: the cards stay idle with their Generate button.
          .catch(() => {});
      }
      return;
    }

    setItems(artifacts.map((artifact) => ({ artifact, status: 'waiting' as const })));

    // Two requests, not one per artifact: the four question-shaped artifacts in one batched call, the lesson plan in its own
    // (a different shape and the largest output). That cuts 7 Gemini calls per question to 4 against a 20-per-minute limit,
    // and they run in parallel so the lesson plan doesn't wait behind the assessments.
    const runBatch = async () => {
      const input = assessmentSetInputFor(plan);
      if (!input) return;

      const batched = input.items.map((i) => artifactForFormat(i.format)).filter(Boolean) as ClassroomArtifact[];
      setItems((prev) =>
        prev.map((i) => (batched.includes(i.artifact) ? { ...i, status: 'generating' } : i))
      );

      try {
        const { results } = await generateAssessmentSet(input);
        if (cancelled.current) return;

        // The server returns what succeeded even if one artifact failed, so each card settles from its own result.
        setItems((prev) =>
          prev.map((item) => {
            const result = results.find((r) => artifactForFormat(r.format) === item.artifact);
            if (!result) return item;
            return result.content
              ? { ...item, status: 'ready' as const, content: result.content }
              : { ...item, status: 'failed' as const, error: result.error || 'Could not generate.' };
          })
        );
      } catch (err) {
        if (cancelled.current) return;
        // The whole batch failed (transport, auth, rate limit); only the cards it covered are affected.
        const message = err instanceof ApiError ? err.message : 'Could not generate. Please try again.';
        setItems((prev) =>
          prev.map((i) => (batched.includes(i.artifact) ? { ...i, status: 'failed', error: message } : i))
        );
      }
    };

    const generateOne = async (artifact: ClassroomArtifact) => {
      const request = generateArtifact(artifact, plan);
      if (!request) return;

      setItems((prev) => prev.map((i) => (i.artifact === artifact ? { ...i, status: 'generating' } : i)));
      try {
        const result = await request;
        if (cancelled.current) return;
        setItems((prev) =>
          prev.map((i) => (i.artifact === artifact ? { ...i, status: 'ready', content: result.content } : i))
        );
      } catch (err) {
        if (cancelled.current) return;
        // One artifact failing mustn't touch the others: each card owns its outcome and Retry, and a shared error would discard work that succeeded.
        setItems((prev) =>
          prev.map((i) =>
            i.artifact === artifact
              ? {
                  ...i,
                  status: 'failed',
                  error: err instanceof ApiError ? err.message : 'Could not generate. Please try again.',
                }
              : i
          )
        );
      }
    };

    void runBatch();
    if (artifacts.includes('lesson_plan')) void generateOne('lesson_plan');

    // Leaving the page mid-queue must stop generation and not write state into an unmounted component.
    return () => {
      cancelled.current = true;
    };
  }, [plan, restored]);

  const stop = useCallback(() => {
    cancelled.current = true;
    // Only unfinished cards are marked stopped; anything already generated stays usable.
    setItems((prev) =>
      prev.map((i) => (i.status === 'waiting' || i.status === 'generating' ? { ...i, status: 'stopped' } : i))
    );
  }, []);

  const retry = useCallback(
    (artifact: ClassroomArtifact) => {
      if (!plan) return;
      const request = generateArtifact(artifact, plan);
      if (!request) return;
      // A retry re-opens the queue for this artifact, overriding an earlier stop.
      cancelled.current = false;
      setItems((prev) =>
        prev.map((i) => (i.artifact === artifact ? { ...i, status: 'generating', error: undefined } : i))
      );
      request
        .then((result) => {
          if (cancelled.current) return;
          setItems((prev) =>
            prev.map((i) => (i.artifact === artifact ? { ...i, status: 'ready', content: result.content } : i))
          );
        })
        .catch((err) => {
          if (cancelled.current) return;
          setItems((prev) =>
            prev.map((i) =>
              i.artifact === artifact
                ? {
                    ...i,
                    status: 'failed',
                    error: err instanceof ApiError ? err.message : 'Could not generate. Please try again.',
                  }
                : i
            )
          );
        });
    },
    [plan]
  );

  // Persist whatever is ready once the turn stops changing. Keyed on the ready content (so a later regeneration is stored
  // too) and debounced, since a batch settles several cards at once and each would otherwise be its own PUT. Best-effort: a
  // failed write only means reopening the chat offers to rebuild. Never persists a restored turn, which would write back what
  // was just read.
  const readyKey = items
    .filter((i) => i.status === 'ready' && i.content)
    .map((i) => `${i.artifact}:${i.content!.length}`)
    .join('|');

  useEffect(() => {
    if (!queryId || restored || readyKey === '') return;

    const timer = setTimeout(() => {
      const artifacts: StoredArtifacts = {};
      for (const item of latest.current) {
        if (item.status === 'ready' && item.content) artifacts[item.artifact] = item.content;
      }
      if (Object.keys(artifacts).length === 0) return;
      void storeArtifacts(queryId, artifacts).catch(() => {});
    }, 600);

    return () => clearTimeout(timer);
  }, [queryId, restored, readyKey]);

  const running = items.some((i) => i.status === 'waiting' || i.status === 'generating');

  return { items, running, stop, retry };
}
