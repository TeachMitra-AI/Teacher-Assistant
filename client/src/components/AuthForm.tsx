import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Mail, Lock, User, Eye, EyeOff, CircleAlert, ArrowLeft, Lightbulb, Languages, BookOpen } from 'lucide-react';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { GOOGLE_CLIENT_ID } from '../config';
import { useRetryCountdown } from '../hooks/useRetryCountdown';
import { formatRetryWait } from '../lib/retryCountdown';
import type { AuthOutcome, SchoolOption } from '../types';

export type Mode = 'login' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Which panel the card shows. Sign-in and sign-up can end somewhere other than "you're in": waiting on an approver, turned
// down, or needing to pick a school.
type View = 'form' | 'pending' | 'rejected' | 'school_picker';

// What to re-submit once a school is picked; sign-in needs the credentials again since the first attempt issued no session.
type Attempt =
  | { via: 'password'; email: string; password: string }
  | { via: 'google'; idToken: string };

// The auth form, used as the /login page content (LoginPage) and inside the pop-up (AuthModal). `initialMode` sets the
// active tab on mount and is read once, like LoginPage's ?mode=register param.
export default function AuthForm({ theme, initialMode = 'login' }: { theme: 'light' | 'dark'; initialMode?: Mode }) {
  const { login, register, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [view, setView] = useState<View>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [schoolChoices, setSchoolChoices] = useState<SchoolOption[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);

  // The auth endpoints' own rate limiter (server/src/index.js's authLimiter), hit by repeated failed attempts —
  // distinct from a wrong-password error, this one has a known recovery time, so it gets a live countdown instead
  // of a static "try again later" the teacher can't act on.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const { remainingMs: retryRemainingMs, ready: retryReady } = useRetryCountdown(retryAt);
  useEffect(() => {
    if (retryAt != null && retryReady) setRetryAt(null);
  }, [retryAt, retryReady]);

  // Field errors surface only after a field is visited (blur) or a submit is attempted, so nothing is flagged on the first pass.
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  function touch(field: keyof typeof touched) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }
  const emailError = touched.email && email.length > 0 && !EMAIL_RE.test(email.trim())
    ? 'Enter a valid email address.'
    : '';
  const passwordError = touched.password && password.length > 0 && password.length < 8
    ? 'Password must be at least 8 characters.'
    : '';

  // Google's button won't take a percentage width, so to match the full-width submit button its pixel width is measured off
  // this wrapper and kept in sync across breakpoints and font-size changes via ResizeObserver.
  const googleWrapRef = useRef<HTMLDivElement>(null);
  const [googleWidth, setGoogleWidth] = useState<number>();
  useEffect(() => {
    const el = googleWrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setGoogleWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setView('form');
    setError('');
    setRetryAt(null);
    setTouched({});
  }

  function backToForm() {
    setView('form');
    setError('');
    setRetryAt(null);
    setAttempt(null);
    setSchoolChoices([]);
  }

  // Every auth call goes through here, so the four non-success outcomes are handled the same however they were reached.
  function applyOutcome(outcome: AuthOutcome, retry: Attempt | null) {
    if (outcome.kind === 'signed_in') {
      // AuthProvider now holds a user, so the router swaps this page (or the modal's signed-out route tree) out.
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

  // Shared tail of every catch block below: a rate-limit failure with a known reset time gets the countdown instead
  // of the server's static "wait a few minutes" wording, which the teacher has no way to act on.
  function applyError(err: unknown) {
    if (err instanceof ApiError && err.code === 'RATE_LIMITED' && err.retryAt != null) {
      setRetryAt(err.retryAt);
      return;
    }
    setError(describeError(err));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setRetryAt(null);
    // Marking every field touched surfaces the inline errors instead of repeating them in the banner.
    setTouched({ email: true, password: true });

    if (!EMAIL_RE.test(email.trim())) return;
    if (password.length < 8) return;

    setBusy(true);
    try {
      if (mode === 'login') {
        const credentials = { email: email.trim(), password };
        applyOutcome(await login(credentials), { via: 'password', ...credentials });
      } else {
        const credentials = { email: email.trim(), password };
        applyOutcome(
          await register({
            name: name.trim(),
            ...credentials,
          }),
          { via: 'password', ...credentials }
        );
      }
    } catch (err) {
      applyError(err);
    } finally {
      setBusy(false);
    }
  }

  // Google returns an ID token; which account it maps to, approval and school assignment are decided server-side from the verified token.
  async function handleGoogleToken(idToken: string) {
    setError('');
    setRetryAt(null);

    setBusy(true);
    try {
      const options = mode === 'register' ? { signup: true, name: name.trim() || undefined } : undefined;
      applyOutcome(await loginWithGoogle(idToken, options), { via: 'google', idToken });
    } catch (err) {
      applyError(err);
    } finally {
      setBusy(false);
    }
  }

  // Re-runs the original attempt, this time naming the school.
  async function chooseSchool(school: SchoolOption) {
    if (!attempt) return;
    setError('');
    setRetryAt(null);
    setBusy(true);
    try {
      const outcome =
        attempt.via === 'password'
          ? await login({ email: attempt.email, password: attempt.password, schoolId: school.id })
          : await loginWithGoogle(attempt.idToken, { schoolId: school.id });
      applyOutcome(outcome, attempt);
    } catch (err) {
      applyError(err);
      setView('form');
    } finally {
      setBusy(false);
    }
  }

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
    <>
      <div className="auth-brand">
        <img src="/logo.png" alt="" className="auth-brand-logo" />
        <h1>SarasTech</h1>
        <p>{subtitle}</p>
      </div>

      {/* Stands in for the hero panel when there isn't one (the modal) or once it's hidden below 820px (see .auth-value-strip
          in index.css), so mobile still gets a compact value proposition. */}
      <ul className="auth-value-strip" aria-hidden="true">
        <li><Lightbulb size={13} aria-hidden="true" /> Lesson ideas</li>
        <li><Languages size={13} aria-hidden="true" /> 9 languages</li>
        <li><BookOpen size={13} aria-hidden="true" /> Classroom-ready</li>
      </ul>

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
                disabled={busy || (retryAt != null && !retryReady)}
              >
                {school.name} ({school.code})
              </button>
            ))}

            {retryAt != null && !retryReady ? (
              <p className="auth-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" /> Too many attempts. You can try again in {formatRetryWait(retryRemainingMs)}.
              </p>
            ) : (
              error && (
                <p className="auth-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" /> {error}
                </p>
              )
            )}

            <button type="button" className="btn-text auth-back" onClick={backToForm} disabled={busy}>
              <ArrowLeft size={15} aria-hidden="true" /> Back
            </button>
          </div>
        </>
      )}

      {view === 'form' && (
        <>
          <form onSubmit={handleSubmit} className="auth-form">
            {mode === 'register' && (
              <label className="auth-field">
                <span className="auth-field-label">Your name</span>
                <span className="auth-input">
                  <User className="auth-input-icon" size={16} aria-hidden="true" />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                    autoComplete="name"
                    required
                  />
                </span>
              </label>
            )}

            <label className="auth-field">
              <span className="auth-field-label">Email</span>
              <span className="auth-input">
                <Mail className="auth-input-icon" size={16} aria-hidden="true" />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => touch('email')}
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'email-error' : undefined}
                  required
                />
              </span>
              {emailError && <span className="auth-field-error" id="email-error">{emailError}</span>}
            </label>

            <label className="auth-field">
              <span className="auth-field-label">Password</span>
              <span className="auth-input">
                <Lock className="auth-input-icon" size={16} aria-hidden="true" />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => touch('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={8}
                  aria-describedby={passwordError ? 'password-help' : mode === 'register' ? 'password-help' : undefined}
                  aria-invalid={!!passwordError}
                  required
                />
                <button
                  type="button"
                  className="auth-input-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </span>
              {passwordError ? (
                <span className="auth-field-error" id="password-help">{passwordError}</span>
              ) : (
                mode === 'register' && (
                  <span className="auth-field-help" id="password-help">At least 8 characters. Choose something you will remember.</span>
                )
              )}
            </label>

            {retryAt != null && !retryReady ? (
              <p className="auth-error" role="alert">
                <CircleAlert size={16} aria-hidden="true" /> Too many attempts. You can try again in {formatRetryWait(retryRemainingMs)}.
              </p>
            ) : (
              error && (
                <p className="auth-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" /> {error}
                </p>
              )
            )}

            <button
              type="submit"
              className="btn-primary auth-submit"
              disabled={busy || (retryAt != null && !retryReady)}
              aria-busy={busy}
            >
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

          {/* Google is a parallel option alongside the form on both tabs, rendered only when a client ID is configured. */}
          {GOOGLE_CLIENT_ID && (
            <>
              <div className="auth-divider" role="presentation"><span>or</span></div>
              <div className="auth-google" ref={googleWrapRef}>
                {/* GoogleOAuthProvider lives at the app root (App.tsx) so GSI initializes once, not on every tab switch. */}
                <GoogleLogin
                  // Remounted on mode/theme/width changes: Google's button doesn't re-theme or resize live, and mode changes its label.
                  key={`${mode}-${theme}-${googleWidth}`}
                  theme={theme === 'dark' ? 'filled_black' : 'outline'}
                  width={googleWidth}
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
                </button>
                .
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
    </>
  );
}
