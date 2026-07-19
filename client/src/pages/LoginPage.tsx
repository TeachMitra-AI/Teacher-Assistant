import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';

export default function LoginPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [schoolCode, setSchoolCode] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { theme, toggleTheme } = preferences;

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!/^\d{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }

    setBusy(true);
    try {
      const credentials = { schoolCode: schoolCode.trim(), name: name.trim(), pin };
      if (mode === 'login') await login(credentials);
      else await register(credentials);
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
            <p>{mode === 'login' ? 'Welcome back — sign in to continue.' : 'Create your teacher account.'}</p>
          </div>

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

          <form onSubmit={handleSubmit} className="auth-form">
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

            <label className="auth-field">
              <span className="auth-field-label">6-digit PIN</span>
              <span className="auth-input">
                <span className="auth-input-icon" aria-hidden="true">🔑</span>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter 6 digits"
                  inputMode="numeric"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  className="auth-input-toggle"
                  onClick={() => setShowPin((s) => !s)}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  aria-pressed={showPin}
                >
                  {showPin ? '🙈' : '👁️'}
                </button>
              </span>
              {mode === 'register' && (
                <span className="auth-field-help">Choose a PIN you will remember.</span>
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

          <p className="auth-hint">
            {mode === 'login' ? (
              <>
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
        </div>
      </div>
    </div>
  );
}
