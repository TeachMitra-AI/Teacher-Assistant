import { describe, expect, it } from 'vitest';
import { emailError, passwordError } from './authValidation';

describe('emailError', () => {
  it('accepts a normal address and ignores surrounding spaces', () => {
    expect(emailError('  teacher@example.com ')).toBe('');
  });

  it('flags an address without an @ or a domain', () => {
    expect(emailError('abc')).toBe('Enter a valid email address.');
    expect(emailError('abc@example')).toBe('Enter a valid email address.');
  });

  it('says nothing for an empty field (the form\'s required check covers that)', () => {
    expect(emailError('')).toBe('');
    expect(emailError('   ')).toBe('');
  });
});

describe('passwordError', () => {
  it('sign-in does not apply the 8-character minimum, so an older short password still works', () => {
    expect(passwordError('abc123', 'login')).toBe('');
    expect(passwordError('a', 'login')).toBe('');
  });

  it('sign-in refuses more than 72 characters, the most bcrypt can hold', () => {
    expect(passwordError('x'.repeat(72), 'login')).toBe('');
    expect(passwordError('x'.repeat(73), 'login')).toBe('Password must be at most 72 characters.');
  });

  it('a new password must be at least 8 characters', () => {
    expect(passwordError('short77', 'register')).toBe('Password must be at least 8 characters.');
    expect(passwordError('eight888', 'register')).toBe('');
  });

  it('a new password also has the 72-character maximum', () => {
    expect(passwordError('x'.repeat(73), 'register')).toBe('Password must be at most 72 characters.');
  });

  it('says nothing for an empty new password, so the field is not flagged before anything is typed', () => {
    expect(passwordError('', 'register')).toBe('');
  });
});
