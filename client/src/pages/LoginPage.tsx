import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { GOOGLE_CLIENT_ID } from '../config';
import { usePreferences } from '../hooks/usePreferences';
import type { AuthOutcome, SchoolOption } from '../types';

type Mode = 'login' | 'register';

// Which panel the card is showing. Sign-in and sign-up can both end somewhere
// other than "you're in": waiting on an approver, turned down, or needing to
// say which school they meant.
type View = 'form' | 'pending' | 'rejected' | 'school_picker';

// Remembers what to re-submit once a school has been picked. Sign-in needs the
// credentials again because the first attempt intentionally issued no session.
type Attempt =
  | { via: 'password'; email: string; password: string }
  | { via: 'google'; idToken: string };

export default function LoginPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { login, register, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [view, setView] = useState<View>('form');
  const [schoolCode, setSchoolCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [schoolChoices, setSchoolChoices] = useState<SchoolOption[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const { theme, toggleTheme } = preferences;

  function switchMode(next: Mode) {
    setMode(next);
    setView('form');
    setError('');
  }

  function backToForm() {
    setView('form');
    setError('');
    setAttempt(null);
    setSchoolChoices([]);
  }

  // Every auth call funnels through here, so the four non-success outcomes are
  // handled identically however they were reached (password or Google, first
  // attempt or after picking a school).
  function applyOutcome(outcome: AuthOutcome, retry: Attempt | null) {
    if (outcome.kind === 'signed_in') {
      // AuthProvider now holds a user, so the router swaps this page out.
      return;
    }
    if (outcome.kind === 'pending') {
      setView('pending');
      return;
    }
    if (outcome.kind === 'rejected') {
      setView('rejected');
      return;
    }
    if (outcome.kind === 'needs_school') {
      setSchoolChoices(outcome.schools);
      setAttempt(retry);
      setView('school_picker');
      return;
    }
    if (outcome.kind === 'not_registered') {
      setError('No account here uses that Google address yet. Switch to Register and enter your school code to sign up.');
      return;
    }
    if (outcome.kind === 'unavailable') {
      setError('Google sign-in is not set up on this server yet. Please use your email and password.');
    }
  }

  function describeError(err: unknown) {
    return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        const credentials = { email: email.trim(), password };
        applyOutcome(await login(credentials), { via: 'password', ...credentials });
      } else {
        applyOutcome(
          await register({
            schoolCode: schoolCode.trim(),
            name: name.trim(),
            email: email.trim(),
            password,
          }),
          null
        );
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // Google hands back an ID token; everything else (which account it maps to,
  // whether it's approved) is decided server-side from the verified token.
  async function handleGoogleToken(idToken: string) {
    setError('');

    if (mode === 'register' && !schoolCode.trim()) {
      setError('Enter your school code first, then continue with Google.');
      return;
    }

    setBusy(true);
    try {
      const options =
        mode === 'register' ? { schoolCode: schoolCode.trim(), name: name.trim() || undefined } : undefined;
      applyOutcome(await loginWithGoogle(idToken, options), { via: 'google', idToken });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // Re-runs the original attempt, this time naming the school.
  async function chooseSchool(school: SchoolOption) {
    if (!attempt) return;
    setError('');
    setBusy(true);
    try {
      const outcome =
        attempt.via === 'password'
          ? await login({ email: attempt.email, password: attempt.password, schoolId: school.id })
          : await loginWithGoogle(attempt.idToken, { schoolId: school.id });
      applyOutcome(outcome, attempt);
    } catch (err) {
      setError(describeError(err));
      setView('form');
    } finally {
      setBusy(false);
    }
  }

  // Google can only create an account once we know which school it belongs to.
  // Sign-in is unaffected: it resolves the account from the verified Google
  // identity alone, so no code is needed there.
  const googleBlocked = mode === 'register' && !schoolCode.trim();

  const subtitle =
    view === 'pending'
      ? 'Almost there — your account needs approval.'
      : view === 'rejected'
        ? 'This account was not approved.'
        : view === 'school_picker'
          ? 'You have an account at more than one school.'
          : mode === 'login'
            ? 'Welcome back — sign in to continue.'
            : 'Create your teacher account.';

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
        <aside className="auth-hero" aria-hidden="true">
          <div className="auth-hero-inner">
            <div className="auth-hero-logo">👨‍🏫</div>
            <h2 className="auth-hero-title">शिक्षक सहायक</h2>
            <p className="auth-hero-tagline">
              Your AI teaching companion — practical, classroom-ready advice in your language.
            </p>
            <ul className="auth-hero-points">
              <li><span>💡</span> Instant lesson ideas &amp; activities</li>
              <li><span>🗣️</span> Answers in 9 Indian languages</li>
              <li><span>📚</span> Built for real classrooms</li>
            </ul>
          </div>
        </aside>

        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-logo" aria-hidden="true">👨‍🏫</span>
            <h1>शिक्षक सहायक</h1>
            <p>{subtitle}</p>
          </div>

          {view === 'form' && (
            <div className="auth-tabs" role="group" aria-label="Choose sign in or register">
              <button
                className={mode === 'login' ? 'active' : ''}
                aria-pressed={mode === 'login'}
                onClick={() => switchMode('login')}
                type="button"
              >
                Sign in
              </button>
              <button
                className={mode === 'register' ? 'active' : ''}
                aria-pressed={mode === 'register'}
                onClick={() => switchMode('register')}
                type="button"
              >
                Register
              </button>
            </div>
          )}

          {view === 'pending' && (
            <>
              <p className="auth-hint" role="status">
                Your registration has been received. A school administrator needs to approve it before you
                can sign in — you&apos;ll be able to log in with your email and password once they do.
              </p>
              <button type="button" className="btn-primary auth-submit" onClick={() => switchMode('login')}>
                Back to sign in
              </button>
            </>
          )}

          {view === 'rejected' && (
            <>
              <p className="auth-hint" role="status">
                A school administrator did not approve this account. Please check with your school
                administrator if you think this is a mistake.
              </p>
              <button type="button" className="btn-primary auth-submit" onClick={() => switchMode('login')}>
                Back to sign in
              </button>
            </>
          )}

          {view === 'school_picker' && (
            <>
              <p className="auth-hint" role="status">
                Which school are you signing in to?
              </p>
              <div className="auth-form">
                {schoolChoices.map((school) => (
                  <button
                    key={school.id}
                    type="button"
                    className="btn-primary auth-submit"
                    onClick={() => chooseSchool(school)}
                    disabled={busy}
                  >
                    {school.name} ({school.code})
                  </button>
                ))}

                {error && (
                  <p className="auth-error" role="alert">
                    <span aria-hidden="true">⚠️</span> {error}
                  </p>
                )}

                <button type="button" className="btn-text" onClick={backToForm} disabled={busy}>
                  ← Back
                </button>
              </div>
            </>
          )}

          {view === 'form' && (
            <>
              <form onSubmit={handleSubmit} className="auth-form">
                {/* The school code picks the tenant, so it's needed only when
                    creating an account — never to sign back in. */}
                {mode === 'register' && (
                  <>
                    <label className="auth-field">
                      <span className="auth-field-label">School code</span>
                      <span className="auth-input">
                        <span className="auth-input-icon" aria-hidden="true">🏫</span>
                        <input
                          value={schoolCode}
                          onChange={(e) => setSchoolCode(e.target.value)}
                          placeholder="e.g. RAMPUR01"
                          autoComplete="off"
                          autoCapitalize="characters"
                          required
                        />
                      </span>
                      <span className="auth-field-help">Provided by your school administrator.</span>
                    </label>

                    <label className="auth-field">
                      <span className="auth-field-label">Your name</span>
                      <span className="auth-input">
                        <span className="auth-input-icon" aria-hidden="true">👤</span>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Full name"
                          autoComplete="name"
                          required
                        />
                      </span>
                    </label>
                  </>
                )}

                <label className="auth-field">
                  <span className="auth-field-label">Email</span>
                  <span className="auth-input">
                    <span className="auth-input-icon" aria-hidden="true">✉️</span>
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
                </label>

                <label className="auth-field">
                  <span className="auth-field-label">Password</span>
                  <span className="auth-input">
                    <span className="auth-input-icon" aria-hidden="true">🔑</span>
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
                  {mode === 'register' && (
                    <span className="auth-field-help">At least 8 characters. Choose something you will remember.</span>
                  )}
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
                  ) : mode === 'login' ? (
                    'Sign in'
                  ) : (
                    'Create account'
                  )}
                </button>
              </form>

              {/* Google is a fully parallel option, not a replacement — it sits
                  alongside the form on both tabs. Rendered only when a client ID
                  is configured; without one there is nothing that could work. */}
              {GOOGLE_CLIENT_ID && (
                <>
                  <p className="auth-hint">or</p>
                  {/* Blocked until a school code is entered, but only on
                      Register — signing in needs no code, so the button stays
                      live on that tab by design. */}
                  <div
                    className="auth-google"
                    onClick={
                      googleBlocked
                        ? () => setError('Enter your school code first, then continue with Google.')
                        : undefined
                    }
                  >
                    <div className={googleBlocked ? 'auth-google-blocked' : undefined}>
                      {/* GoogleOAuthProvider lives at the app root (App.tsx) so
                          GSI initializes once, not on every tab switch. */}
                      <GoogleLogin
                        // Remounts the button when the tab changes, so its label
                        // follows the mode instead of being cached from first render.
                        key={mode}
                        text={mode === 'login' ? 'signin_with' : 'signup_with'}
                        onSuccess={(credentialResponse) => {
                          if (credentialResponse.credential) {
                            handleGoogleToken(credentialResponse.credential);
                          } else {
                            setError('Google did not return a sign-in token. Please try again.');
                          }
                        }}
                        onError={() => setError('Google sign-in was cancelled or failed. Please try again.')}
                      />
                    </div>
                  </div>
                  {googleBlocked && (
                    <p className="auth-hint">Enter your school code above before continuing with Google.</p>
                  )}
                </>
              )}

              <p className="auth-hint">
                {mode === 'login' ? (
                  <>
                    <Link className="auth-link" to="/forgot-password">
                      Forgot your password?
                    </Link>
                    <br />
                    First time here?{' '}
                    <button type="button" className="auth-link" onClick={() => switchMode('register')}>
                      Create an account
                    </button>{' '}
                    with your school code.
                  </>
                ) : (
                  <>
                    Already registered?{' '}
                    <button type="button" className="auth-link" onClick={() => switchMode('login')}>
                      Sign in instead
                    </button>
                    .
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
