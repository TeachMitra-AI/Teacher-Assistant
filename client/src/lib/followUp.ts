import { MAX_QUERY_LENGTH } from '../config';

// Appends a short follow-up instruction to the original question, trimming
// the suffix (never the question) if the combined length would exceed the
// server's query cap. Falls back to the original question unchanged if
// there isn't enough room left for a meaningful instruction.
export function buildSuffixedQuery(original: string, suffix: string): string {
  const combined = `${original}${suffix}`;
  if (combined.length <= MAX_QUERY_LENGTH) return combined;

  const budget = MAX_QUERY_LENGTH - original.length;
  if (budget < 8) return original;
  return `${original}${suffix.slice(0, budget)}`.trimEnd();
}
