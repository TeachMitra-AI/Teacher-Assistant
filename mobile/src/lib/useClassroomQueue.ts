// Native port of client/src/hooks/useClassroomQueue.ts — the generation
// queue behind a Classroom Mode turn (docs/classroom-mode.md P3). Plain React
// state-machine logic with no DOM dependency, so this ports essentially
// verbatim; only the import paths differ.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  artifactForFormat,
  assessmentSetInputFor,
  buildableFrom,
  generateArtifact,
  loadStoredArtifacts,
  storeArtifacts,
  type StoredArtifacts,
} from './classroom';
import { generateAssessmentSet } from '../api/resources';
import { ApiError } from '../api/client';
import type { ClassroomArtifact, ClassroomPlan } from '../types';

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
 *   turn that just ran (D24) — a restored plan renders its cards idle
 *   (`stopped`) and spends nothing until the teacher presses Generate.
 */
export function useClassroomQueue(
  plan: ClassroomPlan | null | undefined,
  restored = false,
  queryId?: string
): ClassroomQueue {
  const [items, setItems] = useState<ArtifactState[]>([]);

  const latest = useRef<ArtifactState[]>([]);
  latest.current = items;

  const cancelled = useRef(false);
  const startedFor = useRef<ClassroomPlan | null>(null);

  useEffect(() => {
    cancelled.current = false;

    if (!plan || startedFor.current === plan) return;
    startedFor.current = plan;

    const artifacts = buildableFrom(plan);
    if (artifacts.length === 0) {
      setItems([]);
      return;
    }

    if (restored) {
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
          .catch(() => {});
      }
      return;
    }

    setItems(artifacts.map((artifact) => ({ artifact, status: 'waiting' as const })));

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

    return () => {
      cancelled.current = true;
    };
    // `queryId` deliberately excluded — mirrors client/src/hooks/useClassroomQueue.ts's
    // own dependency array exactly. This effect is keyed on `plan`'s identity
    // (a fresh generation run only when the TURN changes); queryId is read
    // fresh from the closure when the restored branch above needs it, and is
    // never expected to change independently of plan for the same turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, restored]);

  const stop = useCallback(() => {
    cancelled.current = true;
    setItems((prev) =>
      prev.map((i) => (i.status === 'waiting' || i.status === 'generating' ? { ...i, status: 'stopped' } : i))
    );
  }, []);

  const retry = useCallback(
    (artifact: ClassroomArtifact) => {
      if (!plan) return;
      const request = generateArtifact(artifact, plan);
      if (!request) return;
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
