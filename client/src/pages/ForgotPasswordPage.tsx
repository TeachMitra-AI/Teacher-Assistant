import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Sun, Moon, CircleAlert, ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';

// Step one of self-service password reset: ask for an email, and the server
// mails a single-use link.
//
// The confirmation below is deliberately worded to say nothing about whether
// the address actually has an account — the endpoint answers identically either
// way so it can't be used to find out who is registered, and the UI must not
// give that away after the fact.
export default function ForgotPasswordPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { theme, toggleTheme } = preferences;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
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
        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>

      <div className="auth-layout">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-logo" aria-hidden="true"><KeyRound size={22} /></span>
            <h1>Reset your password</h1>
            <p>
              {sent
                ? 'Check your inbox for the next step.'
                : 'Enter your email and we will send you a reset link.'}
            </p>
          </div>

          {sent ? (
            <>
              <p className="auth-hint" role="status">
                If an account exists for <strong>{email.trim()}</strong>, a password reset link is on its way.
                The link expires in about an hour. Remember to check your spam folder.
              </p>
              <Link className="btn-primary auth-submit" to="/login">
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="auth-form">
              <label className="auth-field">
                <span className="auth-field-label">Email</span>
                <span className="auth-input">
                  <Mail className="auth-input-icon" size={16} aria-hidden="true" />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </span>
                <span className="auth-field-help">The address you use to sign in.</span>
              </label>

              {error && (
                <p className="auth-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" /> {error}
                </p>
              )}

              <button type="submit" className="btn-primary auth-submit" disabled={busy} aria-busy={busy}>
                {busy ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" /> Please wait…
                  </>
                ) : (
                  'Send reset link'
                )}
              </button>

              <p className="auth-hint">
                <Link className="auth-link auth-back-link" to="/login">
                  <ArrowLeft size={13} aria-hidden="true" /> Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
