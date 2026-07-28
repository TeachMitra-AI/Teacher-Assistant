// AI Action Router — the Generator's one seam into the router (Milestone M3).
//
// This module exists so that GeneratorPage's contact with the router is a
// single import from a single file. That is guardrail G14: a page must not
// consume RouterProvider, must render correctly with the router absent, and
// must stay trivially separable from it. Deleting client/src/assistant/ should
// break one import line in the page, not a scattering of them.
//
// It also puts the interesting logic somewhere it can be TESTED. Coercing an
// untrusted params object into typed form values is exactly the kind of pure
// function the client test runner was added for; the same logic inlined in a
// component would only ever be exercised by hand.
//
// The page keeps its own form state (§5.5 of the spec). This module never holds
// state, never navigates, and never renders — it converts a stored draft into
// values the page can seed itself with, and records what the teacher then does
// with them.

import {
  ASSESSMENT_FORMATS,
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_MAX,
} from '../config';
import { markConsumed, readDraft } from './draftStore';
import { recordFieldCorrection, recordPrefillApplied, recordUndoAll } from './telemetry';
import type { ProvenanceSource } from './types';

/** The only action that prefills this page. A draft for anything else is ignored rather than guessed at. */
const ACTION_ID = 'generate_assessment';

/** Mirrors the Generator's own field types. Every key is optional: a draft may fill any subset. */
export interface PrefillValues {
  format?: 'quiz' | 'worksheet';
  grade?: string;
  subject?: string;
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  questionType?: 'mcq' | 'true_false' | 'short_answer' | 'mixed';
  questionCount?: number;
  language?: string;
}

export interface GeneratorPrefill {
  values: PrefillValues;
  /** Only for fields actually applied, so the page can never mark a field it did not fill. */
  provenance: Record<string, ProvenanceSource>;
  lowConfidenceFields: string[];
  /** Display only, for the banner. Never sent anywhere. */
  utterance: string;
}

const FORMAT_VALUES = ASSESSMENT_FORMATS.map((f) => f.value);
const DIFFICULTY_VALUES = DIFFICULTIES.map((d) => d.value);
const QUESTION_TYPE_VALUES = QUESTION_TYPES.map((q) => q.value);

/** A bounded, trimmed string, or undefined when there is nothing usable. */
function asText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function asMember<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Turns an untrusted params object into typed form values, dropping anything
 * that does not fit.
 *
 * Params arriving from the server have already been validated against the real
 * generation schema, so in the normal case nothing is dropped. This exists for
 * the two cases that are not normal, both of which are routine rather than
 * theoretical:
 *
 *   - Hand-written drafts, which is how M3 is verified at all.
 *   - A service-worker-cached client reading a draft written by a NEWER build.
 *     This is the spec's "version check" (§6.1 step 3) in its useful form:
 *     rather than comparing version numbers and refusing wholesale, apply every
 *     field this build recognises and ignore the rest. A teacher gets six
 *     correct fields instead of an empty form because their PWA is a day stale.
 *
 * Field bounds come from the client's picker vocabulary in config.ts, which a
 * drift guard already pins to the server's generation schema (added in M2), so
 * this introduces no second definition of the vocabulary.
 */
export function coercePrefillValues(params: unknown): PrefillValues {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return {};
  const raw = params as Record<string, unknown>;
  const values: PrefillValues = {};

  const format = asMember(raw.format, FORMAT_VALUES);
  if (format) values.format = format;

  // 200 / 80 match the maxLength already enforced by the form's own inputs.
  const topic = asText(raw.topic, 200);
  if (topic) values.topic = topic;

  const grade = asText(raw.grade, 80);
  if (grade) values.grade = grade;

  const subject = asText(raw.subject, 80);
  if (subject) values.subject = subject;

  const difficulty = asMember(raw.difficulty, DIFFICULTY_VALUES);
  if (difficulty) values.difficulty = difficulty;

  const questionType = asMember(raw.questionType, QUESTION_TYPE_VALUES);
  if (questionType) values.questionType = questionType;

  // Out-of-range counts are DROPPED, never clamped: a clamp would silently turn
  // "50 questions" into 30 and look like the router understood the request.
  // Dropping it leaves the form's own default, which is honest.
  if (
    typeof raw.questionCount === 'number' &&
    Number.isInteger(raw.questionCount) &&
    raw.questionCount >= QUESTION_COUNT_MIN &&
    raw.questionCount <= QUESTION_COUNT_MAX
  ) {
    values.questionCount = raw.questionCount;
  }

  const language = asText(raw.language, 20);
  if (language) values.language = language;

  return values;
}

/**
 * Loads the prefill for a draft handle, or null when there is nothing to apply.
 *
 * Null covers every "behave exactly as today" case — no handle, unknown handle,
 * expired, already cleared, a draft for a different action, storage unavailable,
 * or params that yielded no usable field. The page's branch is the same for all
 * of them, which is the point.
 */
export function loadPrefill(draftId: string): GeneratorPrefill | null {
  const draft = readDraft(draftId);
  if (!draft) return null;
  if (draft.actionId !== ACTION_ID) return null;

  const values = coercePrefillValues(draft.initialParams);
  const applied = Object.keys(values);
  if (applied.length === 0) return null;

  // Provenance and low-confidence markers are restricted to fields that were
  // actually applied, so the page cannot annotate a field it did not fill.
  const provenance: Record<string, ProvenanceSource> = {};
  for (const field of applied) {
    // A draft with no provenance for a field it filled is possible only from a
    // hand-written record; 'inferred' is the honest label for "we don't know".
    provenance[field] = draft.provenance[field] ?? 'inferred';
  }

  const lowConfidenceFields = draft.lowConfidenceFields.filter((field) => applied.includes(field));

  recordPrefillApplied(ACTION_ID, applied.length, lowConfidenceFields.length);

  return { values, provenance, lowConfidenceFields, utterance: draft.utterance };
}

/**
 * The teacher edited a field the router had filled. Records the field NAME and
 * where its value had come from — never the value (guardrail G11).
 */
export function notePrefillEdit(field: string, from: ProvenanceSource): void {
  recordFieldCorrection(ACTION_ID, field, from);
}

/**
 * The teacher pressed "Clear AI fields". Marks the draft spent so a later
 * refresh loads plain defaults rather than re-applying values they rejected,
 * and records the undo — a flat rejection is the highest-signal evidence that a
 * routing was simply wrong.
 */
export function discardPrefill(draftId: string, fieldCount: number): void {
  markConsumed(draftId);
  recordUndoAll(ACTION_ID, fieldCount);
}
