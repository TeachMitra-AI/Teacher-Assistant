// Helpers for the exam-paper letterhead. ExamPaperMeta is stored in LibraryResource.structured (a free-form JSON column)
// under "examMeta", alongside the existing generator config rather than replacing it.
import type { ExamPaperDefaults, ExamPaperMeta, User } from '../types';

/** Starting values for a new resource's letterhead, prefilled from the teacher's site-wide defaults (Settings) and School/User identity. */
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

/** Merges an updated examMeta into a resource's structured JSON string, keeping whatever else is stored (e.g. the generator config). */
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
