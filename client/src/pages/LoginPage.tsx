import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { Mail, Lock, User, School, Eye, EyeOff, Sun, Moon, CircleAlert, ArrowLeft, Lightbulb, Languages, BookOpen } from 'lucide-react';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { GOOGLE_CLIENT_ID } from '../config';
import { usePreferences } from '../hooks/usePreferences';
import type { AuthOutcome, SchoolOption } from '../types';

type Mode = 'login' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Field-level errors surface only once a field has been visited (blur) or a
  // submit was attempted — matching the rest of the form, nothing is flagged
  // while the user is still typing their first pass through it.
  const [touched, setTouched] = useState<{ schoolCode?: boolean; email?: boolean; password?: boolean }>({});
  function touch(field: keyof typeof touched) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }
  const emailError = touched.email && email.length > 0 && !EMAIL_RE.test(email.trim())
    ? 'Enter a valid email address.'
    : '';
  const passwordError = touched.password && password.length > 0 && password.length < 8
    ? 'Password must be at least 8 characters.'
    : '';
  const schoolCodeError = touched.schoolCode && schoolCode.length > 0 && /\s/.test(schoolCode)
    ? 'School code should not contain spaces.'
    : '';

  // Google's button won't take a percentage width, so to make it read as
  // part of the same CTA group as the full-width submit button (rather than
  // a smaller, disconnected pill), its pixel width is measured off this
  // wrapper — which is already exactly as wide as the form — and kept in
  // sync across breakpoints and font-size changes via ResizeObserver.
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
    setTouched({});
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
    // Marking every field touched surfaces the matching inline error (see
    // emailError / passwordError / schoolCodeError) instead of duplicating
    // the same message in the top-level banner below.
    setTouched({ schoolCode: true, email: true, password: true });

    if (!EMAIL_RE.test(email.trim())) return;
    if (password.length < 8) return;
    if (mode === 'register' && /\s/.test(schoolCode)) return;

    setBusy(true);
    try {
      if (mode === 'login') {
        const credentials = { email: email.trim(), password };
        applyOutcome(await login(credentials), { via: 'password', ...credentials });
      } else {
        const credentials = { email: email.trim(), password };
        applyOutcome(
          await register({
            schoolCode: schoolCode.trim(),
            name: name.trim(),
            ...credentials,
          }),
          { via: 'password', ...credentials }
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
        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>

      <div className="auth-layout auth-layout--split">
        <aside className="auth-hero" aria-hidden="true">
          <div className="auth-hero-inner">
            <img src="/logo.png" alt="" className="auth-hero-logo" />
            <h2 className="auth-hero-title">SarasTech</h2>
            <p className="auth-hero-tagline">
              Your AI teaching companion — practical, classroom-ready advice in your language.
            </p>
            <ul className="auth-hero-points">
              <li><span><Lightbulb size={15} aria-hidden="true" /></span> Instant lesson ideas &amp; activities</li>
              <li><span><Languages size={15} aria-hidden="true" /></span> Answers in 9 Indian languages</li>
              <li><span><BookOpen size={15} aria-hidden="true" /></span> Built for real classrooms</li>
            </ul>
          </div>
        </aside>

        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.png" alt="" className="auth-brand-logo" />
            <h1>SarasTech</h1>
            <p>{subtitle}</p>
          </div>

          {/* Stands in for the hero panel once it's hidden below 820px (see
              .auth-value-strip / .auth-hero in index.css) — mobile still gets
              a value proposition, just a compact one instead of the full panel. */}
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
                    disabled={busy}
                  >
                    {school.name} ({school.code})
                  </button>
                ))}

                {error && (
                  <p className="auth-error" role="alert">
                    <CircleAlert size={16} aria-hidden="true" /> {error}
                  </p>
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
                {/* The school code picks the tenant, so it's needed only when
                    creating an account — never to sign back in. */}
                {mode === 'register' && (
                  <>
                    <label className="auth-field">
                      <span className="auth-field-label">School code</span>
                      <span className="auth-input">
                        <School className="auth-input-icon" size={16} aria-hidden="true" />
                        <input
                          value={schoolCode}
                          onChange={(e) => setSchoolCode(e.target.value)}
                          onBlur={() => touch('schoolCode')}
                          placeholder="e.g. RAMPUR01"
                          autoComplete="off"
                          autoCapitalize="characters"
                          aria-describedby="schoolcode-help"
                          aria-invalid={!!schoolCodeError}
                          required
                        />
                      </span>
                      {schoolCodeError ? (
                        <span className="auth-field-error" id="schoolcode-help">{schoolCodeError}</span>
                      ) : (
                        <span className="auth-field-help" id="schoolcode-help">Provided by your school administrator.</span>
                      )}
                    </label>

                    <label className="auth-field auth-field-spaced">
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
                  </>
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
                  <div className="auth-divider" role="presentation"><span>or</span></div>
                  {/* Blocked until a school code is entered, but only on
                      Register — signing in needs no code, so the button stays
                      live on that tab by design. */}
                  <div
                    className="auth-google"
                    ref={googleWrapRef}
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
                        // Remounted on mode/theme/width changes: mode changes
                        // its label, Google's own button doesn't re-theme
                        // itself live, and it also won't resize live — each
                        // needs a fresh render to take effect.
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
