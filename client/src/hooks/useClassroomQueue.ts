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

// The generation queue behind a Classroom Mode turn (docs/classroom-mode.md P3).
//
// Reports each artifact's state independently, and can be stopped. Everything
// the cards render comes from here; the components themselves hold no
// generation logic.

// D10 said "two at a time, not five", to keep one teacher's send from looking
// like a burst to the server's own limiters. That is now structural rather
// than enforced by a worker pool: the four question-shaped artifacts travel in
// ONE batched request and the lesson plan in another, so at most two calls are
// ever in flight for a turn. The pool (and this constant) went with them.

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
 *   Mode did not run.
 * @param restored true when the plan came from HISTORY rather than from the
 *   turn that just ran (D24).
 *
 *   This flag is the whole safety of persisting the plan. Without it, opening
 *   an old chat hands this hook a plan it has never seen and it generates the
 *   entire set again — so simply BROWSING history would cost four model calls
 *   per chat, silently, on the free tier's 20-per-minute budget. Restored
 *   plans therefore render their cards in `stopped`, and the teacher decides
 *   whether to spend anything by pressing Generate on the ones they want.
 */
export function useClassroomQueue(
  plan: ClassroomPlan | null | undefined,
  restored = false,
  queryId?: string
): ClassroomQueue {
  const [items, setItems] = useState<ArtifactState[]>([]);

  // Latest items, readable from async work without making every callback
  // depend on the state it is about to replace.
  const latest = useRef<ArtifactState[]>([]);
  latest.current = items;

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

    // A plan restored from history renders its cards idle and spends nothing.
    // `stopped` already means exactly this — planned, not generated, the
    // teacher may ask for it — so it is reused rather than adding a sixth
    // status that every switch would have to learn.
    if (restored) {
      // Idle first, so the cards appear immediately rather than after a
      // round trip; anything previously generated then fills in (D25).
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
          // Nothing stored, or the fetch failed: the cards stay idle with
          // their Generate button, which is exactly the pre-D25 behaviour.
          .catch(() => {});
      }
      return;
    }

    setItems(artifacts.map((artifact) => ({ artifact, status: 'waiting' as const })));

    // TWO requests, not one per artifact (2026-08-07).
    //
    // The four question-shaped artifacts go in ONE batched call; the lesson
    // plan keeps its own, because it is a different document shape (D21) and
    // is the single largest output in the set. That takes Classroom Mode from
    // 7 Gemini calls per teacher question to 4 — and the free tier's real
    // limit is 20 requests a MINUTE, so this is the difference between three
    // questions and six before a teacher is throttled.
    //
    // The two run in parallel, so the lesson plan card no longer waits behind
    // the assessments. CONCURRENCY is gone with the worker pool it served:
    // there are now at most two requests in flight by construction.
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

        // Per-artifact outcomes: the server returns what succeeded even when
        // one artifact could not be produced, so each card is settled from its
        // own result rather than the request as a whole.
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
        // The whole batch failed (transport, auth, rate limit). Only the cards
        // it covered are affected — the lesson plan is a separate request.
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

    void runBatch();
    if (artifacts.includes('lesson_plan')) void generateOne('lesson_plan');

    // Leaving the page mid-queue must not keep generating, and must not write
    // state into an unmounted component.
    return () => {
      cancelled.current = true;
    };
  }, [plan, restored]);

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
      const request = generateArtifact(artifact, plan);
      if (!request) return;
      // A retry re-opens the queue for this one artifact: the teacher asked for
      // it again, which overrides an earlier stop.
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

  // Persist whatever is ready, once the turn stops changing (D25).
  //
  // Keyed on the ready CONTENT rather than on a "finished" flag, so a card the
  // teacher regenerates later is stored too — and debounced, because the batch
  // settles several cards in quick succession and each one would otherwise be
  // its own PUT.
  //
  // Best-effort throughout: a failed write costs the teacher nothing they can
  // see now, it only means reopening this chat later offers to rebuild instead
  // of showing what was made. Never persists on a RESTORED turn — that would
  // write back exactly what was just read.
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
