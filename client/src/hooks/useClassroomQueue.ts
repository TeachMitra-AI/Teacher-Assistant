import { useCallback, useEffect, useRef, useState } from 'react';
import { generateAssessment } from '../lib/resources';
import { buildableFrom, generationInputFor } from '../lib/classroom';
import { ApiError } from '../api';
import type { ClassroomArtifact, ClassroomPlan } from '../types';

// The generation queue behind a Classroom Mode turn (docs/classroom-mode.md P3).
//
// Runs at most CONCURRENCY generations at a time, reports each artifact's state
// independently, and can be stopped. Everything the cards render comes from
// here; the components themselves hold no generation logic.

// D10. Two, not five.
//
// Five simultaneous generations from ONE teacher pressing send is a burst the
// server's own limiters are entitled to reject (server/src/lib/limiters.js), and
// it would be indistinguishable from abuse. Two keeps a steady pipeline — the
// wall-clock finish time is close to firing all five, without the spike — and
// it means the first card is readable while the rest are still coming.
const CONCURRENCY = 2;

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
 * @param plan the server's plan for this turn, or null/undefined when Classroom
 *   Mode did not run. A missing plan produces an empty, inert queue — the hook
 *   is always called (rules of hooks) and simply does nothing.
 */
export function useClassroomQueue(plan: ClassroomPlan | null | undefined): ClassroomQueue {
  const [items, setItems] = useState<ArtifactState[]>([]);

  // Cancellation. Read inside async work to decide whether a result is still
  // wanted; flipped by stop() and by unmount.
  const cancelled = useRef(false);
  // Guards against a second run for the same plan. The effect is keyed on the
  // plan's identity, but React may re-run effects (StrictMode double-invoke in
  // development, most visibly) and a second run here means paying for every
  // generation twice.
  const startedFor = useRef<ClassroomPlan | null>(null);

  // `plan` is a fresh object each render only if the parent rebuilds it; it
  // comes from turn.response, which is stable per turn, so identity is a safe
  // key. Using the topic string instead would re-fire whenever two consecutive
  // questions shared a topic.
  useEffect(() => {
    // Un-cancel FIRST, before the dedupe guard below.
    //
    // Order is load-bearing, and getting it wrong is silent. React StrictMode
    // double-invokes effects in development: run 1 starts the workers, its
    // cleanup sets `cancelled = true`, then run 2 fires. If the dedupe guard
    // came first, run 2 would return early having never un-cancelled — and run
    // 1's still-in-flight generations would complete, see `cancelled`, and
    // discard their own results. Every card sticks at "Creating…" forever
    // while the requests quietly succeed. (Observed exactly this in a browser
    // run; the unit tests could not see it because they do not double-invoke.)
    //
    // Resetting here instead means a re-run ADOPTS the running workers rather
    // than orphaning them: no duplicate requests, no lost results. On a real
    // unmount nothing re-runs, so the cleanup's cancellation stands.
    cancelled.current = false;

    if (!plan || startedFor.current === plan) return;
    startedFor.current = plan;

    const artifacts = buildableFrom(plan);
    if (artifacts.length === 0) {
      setItems([]);
      return;
    }

    setItems(artifacts.map((artifact) => ({ artifact, status: 'waiting' as const })));

    // A simple index-based worker pool: CONCURRENCY workers pulling from a
    // shared cursor. Chosen over chunking into pairs because a chunked version
    // idles — a fast quiz finishing early cannot start the next artifact until
    // its slower partner finishes too.
    let cursor = 0;
    const runWorker = async () => {
      while (!cancelled.current) {
        const index = cursor;
        cursor += 1;
        if (index >= artifacts.length) return;
        await generateOne(artifacts[index]);
      }
    };

    const generateOne = async (artifact: ClassroomArtifact) => {
      const input = generationInputFor(artifact, plan);
      if (!input) return;

      setItems((prev) => prev.map((i) => (i.artifact === artifact ? { ...i, status: 'generating' } : i)));
      try {
        const result = await generateAssessment(input);
        if (cancelled.current) return;
        setItems((prev) =>
          prev.map((i) => (i.artifact === artifact ? { ...i, status: 'ready', content: result.content } : i))
        );
      } catch (err) {
        if (cancelled.current) return;
        // One artifact failing must not touch the others — each card owns its
        // own outcome and its own Retry. A shared error state here would throw
        // away work that succeeded.
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

    for (let i = 0; i < Math.min(CONCURRENCY, artifacts.length); i += 1) void runWorker();

    // Leaving the page mid-queue must not keep generating, and must not write
    // state into an unmounted component.
    return () => {
      cancelled.current = true;
    };
  }, [plan]);

  const stop = useCallback(() => {
    cancelled.current = true;
    // Only what has not finished is marked stopped. Anything already generated
    // stays usable — the teacher stopped the queue, not their results.
    setItems((prev) =>
      prev.map((i) => (i.status === 'waiting' || i.status === 'generating' ? { ...i, status: 'stopped' } : i))
    );
  }, []);

  const retry = useCallback(
    (artifact: ClassroomArtifact) => {
      if (!plan) return;
      const input = generationInputFor(artifact, plan);
      if (!input) return;
      // A retry re-opens the queue for this one artifact: the teacher asked for
      // it again, which overrides an earlier stop.
      cancelled.current = false;
      setItems((prev) =>
        prev.map((i) => (i.artifact === artifact ? { ...i, status: 'generating', error: undefined } : i))
      );
      generateAssessment(input)
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

  const running = items.some((i) => i.status === 'waiting' || i.status === 'generating');

  return { items, running, stop, retry };
}
