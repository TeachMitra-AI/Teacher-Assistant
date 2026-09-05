// Friendly wording for a non-2xx API response the backend didn't explain
// with its own `error` string (see api.ts). Used ONLY as a last resort —
// an intentional backend-provided message always wins over this.
export function fallbackErrorMessage(status: number): string {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The service is temporarily unavailable. Please try again in a moment.';
  }
  if (status === 500) return 'Something went wrong on our end. Please try again.';
  return `Request failed (${status}).`;
}
