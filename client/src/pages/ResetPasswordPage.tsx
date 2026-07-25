import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';

// Step two of self-service password reset: redeem the emailed token and set a
// new password. The token arrives in the URL, so it is never typed by hand.
//
// A successful reset revokes every existing session server-side, so this page
// sends the teacher to sign in fresh rather than logging them straight in.
export default function ResetPasswordPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { resetPassword } = useAuth();
  const { token = '' } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { theme, toggleTheme } = preferences;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      // An expired, already-used or unknown link lands here with the server's
      // own "request a new one" wording.
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <button
        className="icon-btn auth-theme"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-pressed={theme === 'dark'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <div className="auth-layout">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-logo" aria-hidden="true">🔑</span>
            <h1>Choose a new password</h1>
            <p>{done ? 'Your password has been changed.' : 'Pick something you will remember.'}</p>
          </div>

          {done ? (
            <>
              <p className="auth-hint" role="status">
                You can now sign in with your new password. For safety, you have been signed out
                everywhere else.
              </p>
              <Link className="btn-primary auth-submit" to="/login">
                Go to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="auth-form">
              <label className="auth-field">
                <span className="auth-field-label">New password</span>
                <span className="auth-input">
                  <span className="auth-input-icon" aria-hidden="true">🔑</span>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    className="auth-input-toggle"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </span>
              </label>

              <label className="auth-field">
                <span className="auth-field-label">Confirm new password</span>
                <span className="auth-input">
                  <span className="auth-input-icon" aria-hidden="true">🔑</span>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Type it again"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </span>
              </label>

              {error && (
                <p className="auth-error" role="alert">
                  <span aria-hidden="true">⚠️</span> {error}
                </p>
              )}

              <button type="submit" className="btn-primary auth-submit" disabled={busy} aria-busy={busy}>
                {busy ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" /> Please wait…
                  </>
                ) : (
                  'Set new password'
                )}
              </button>

              <p className="auth-hint">
                Link expired?{' '}
                <Link className="auth-link" to="/forgot-password">
                  Request a new one
                </Link>
                .
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
