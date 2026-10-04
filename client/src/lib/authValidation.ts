// Field rules shared by sign-in, register and forgot-password, so the three forms agree. They mirror the server's rules in
// server/src/routes/auth.js, with one deliberate difference: sign-in checks only the 72-byte maximum. A password set before
// the 8-character minimum existed must still work, or its owner is locked out with no way back short of a reset.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export function emailError(value: string): string {
  return value.trim().length > 0 && !EMAIL_RE.test(value.trim()) ? 'Enter a valid email address.' : '';
}

// `mode` decides whether the minimum applies. Only sign-up sets a password, so only sign-up enforces the minimum.
export function passwordError(value: string, mode: 'login' | 'register'): string {
  if (value.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (mode === 'register' && value.length > 0 && value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return '';
}
