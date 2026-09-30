// The Generator's single seam into the router, so deleting client/src/assistant/ breaks one import line in the page.
// Converts a stored draft into values the page seeds its own form state with, and records what the teacher then does.
// Holds no state, never navigates or renders. Kept as a pure module so the coercion can be unit-tested.

import {
  ASSESSMENT_FORMATS,
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_MAX,
} from '../config';
import { markConsumed, readDraft } from './draftStore';
import { recordFieldCorrection, recordGenerated, recordPrefillApplied, recordUndoAll } from './telemetry';
import {
  notePrefillDelivered,
  notePrefillGenerated,
  notePrefillUndone,
} from './telemetryTransport';
import type { ProvenanceSource } from './types';
import type { AssessmentFormat, QuestionType } from '../lib/resources';

// The only action that prefills this page; a draft for anything else is ignored.
const ACTION_ID = 'generate_assessment';

/** Mirrors the Generator's own field types; every key is optional since a draft may fill any subset. */
export interface PrefillValues {
  // Typed from the client picker (validated against ASSESSMENT_FORMATS), not a hand-written union, so it can't
  // drift when a format is added.
  format?: AssessmentFormat;
  grade?: string;
  subject?: string;
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  // Same as `format`: follows QUESTION_TYPES.
  questionType?: QuestionType;
  questionCount?: number;
  language?: string;
}

export interface GeneratorPrefill {
  values: PrefillValues;
  /** Only fields actually applied, so the page never marks a field it didn't fill. */
  provenance: Record<string, ProvenanceSource>;
  lowConfidenceFields: string[];
  /** Display only, for the banner. */
  utterance: string;
}

const FORMAT_VALUES = ASSESSMENT_FORMATS.map((f) => f.value);
const DIFFICULTY_VALUES = DIFFICULTIES.map((d) => d.value);
const QUESTION_TYPE_VALUES = QUESTION_TYPES.map((q) => q.value);

function asText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function asMember<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

// Turns an untrusted params object into typed form values, dropping whatever doesn't fit. Server params are already
// validated, so this mostly matters for hand-written drafts and for a stale cached client reading a draft from a newer
// build: apply every field this build recognises and ignore the rest, rather than refusing wholesale. Bounds come from
// the picker vocabulary in config.ts, which a drift guard pins to the server's schema.
export function coercePrefillValues(params: unknown): PrefillValues {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return {};
  const raw = params as Record<string, unknown>;
  const values: PrefillValues = {};

  const format = asMember(raw.format, FORMAT_VALUES);
  if (format) values.format = format;

  // Match the maxLength on the form's own inputs.
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

  // Out-of-range counts are dropped, not clamped: clamping "50 questions" to 30 would look like the router understood.
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

// Returns null for every "behave as today" case (no/unknown/expired/cleared handle, another action, no storage, no
// usable field), since the page branches the same way for all of them.
export function loadPrefill(draftId: string): GeneratorPrefill | null {
  const draft = readDraft(draftId);
  if (!draft) return null;
  if (draft.actionId !== ACTION_ID) return null;

  const values = coercePrefillValues(draft.initialParams);
  const applied = Object.keys(values);
  if (applied.length === 0) return null;

  // Only fields actually applied get provenance and low-confidence markers.
  const provenance: Record<string, ProvenanceSource> = {};
  for (const field of applied) {
    // Only hand-written records lack provenance for a filled field; 'inferred' means "we don't know".
    provenance[field] = draft.provenance[field] ?? 'inferred';
  }

  const lowConfidenceFields = draft.lowConfidenceFields.filter((field) => applied.includes(field));

  recordPrefillApplied(ACTION_ID, applied.length, lowConfidenceFields.length);
  // The denominator of the field-edit rate, reported here because only this point proves the prefill reached the form.
  notePrefillDelivered({
    draftId,
    actionId: ACTION_ID,
    requestId: draft.requestId,
    fieldCount: applied.length,
    lowConfidenceCount: lowConfidenceFields.length,
  });

  return { values, provenance, lowConfidenceFields, utterance: draft.utterance };
}

// Records the field name and where its value came from, never the value.
export function notePrefillEdit(field: string, from: ProvenanceSource): void {
  recordFieldCorrection(ACTION_ID, field, from);
}

// Marks the draft spent so a refresh loads defaults instead of re-applying rejected values, and records the undo, the
// strongest sign a routing was wrong.
export function discardPrefill(draftId: string, fieldCount: number): void {
  markConsumed(draftId);
  recordUndoAll(ACTION_ID, fieldCount);
  notePrefillUndone();
}

// Called by an observer of the Generator's state (content becoming non-null while AI provenance is present), never
// from inside `handleGenerate`, which router code must stay out of. The transport latches, so a regenerate can't
// produce a second outcome.
export function notePrefillGeneration(): void {
  recordGenerated(ACTION_ID);
  notePrefillGenerated();
}
