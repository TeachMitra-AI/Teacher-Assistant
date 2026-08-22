// Ported verbatim from client/src/lib/examMeta.ts (docs/mobile-app-plan.md
// §9) — pure logic, only the import path differs. ExamPaperMeta is stored
// inside LibraryResource.structured (a free-form JSON text column already
// used for the generator config), under the key "examMeta" — alongside, not
// replacing, the existing { format, difficulty, questionType, questionCount,
// topic } shape.
import type { ExamPaperDefaults, ExamPaperMeta, User } from '../types';

/** Sensible starting values for a NEW resource's letterhead, prefilled from
 * the teacher's site-wide defaults (Settings) and their School/User identity. */
export function buildInitialExamMeta(user: User, defaults: ExamPaperDefaults | undefined): ExamPaperMeta {
  const d = defaults ?? {};
  return {
    schoolName: d.schoolName ?? user.school.name,
    teacherName: d.teacherName ?? user.displayName ?? user.name,
    customInstructions: d.defaultInstructions ?? '',
    showDate: d.showDate ?? false,
    showTime: d.showTime ?? false,
  };
}

/** Reads examMeta back out of a resource's structured JSON string, if present. */
export function parseExamMeta(structured: string | null | undefined): ExamPaperMeta {
  if (!structured) return {};
  try {
    const parsed = JSON.parse(structured);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.examMeta && typeof parsed.examMeta === 'object') {
      return parsed.examMeta as ExamPaperMeta;
    }
    return {};
  } catch {
    return {};
  }
}

/** Merges an updated examMeta into a resource's existing structured JSON
 * string, preserving whatever else was already stored there (e.g. the
 * generator config) rather than overwriting it. */
export function mergeExamMeta(structured: string | null | undefined, examMeta: ExamPaperMeta): string {
  let base: Record<string, unknown> = {};
  if (structured) {
    try {
      const parsed = JSON.parse(structured);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, examMeta });
}
