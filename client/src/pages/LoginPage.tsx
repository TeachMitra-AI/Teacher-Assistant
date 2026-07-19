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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { theme, toggleTheme } = preferences;

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
      <button className="icon-btn auth-theme" onClick={toggleTheme} aria-label="Toggle dark mode">
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <div className="auth-card">
        <div className="auth-brand">
          <span aria-hidden="true">👨‍🏫</span>
          <h1>शिक्षक सहायक</h1>
          <p>AI coaching assistant for teachers</p>
        </div>

        <div className="auth-tabs">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => { setMode('login'); setError(''); }}
            type="button"
          >
            Sign in
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => { setMode('register'); setError(''); }}
            type="button"
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            School code
            <input
              value={schoolCode}
              onChange={(e) => setSchoolCode(e.target.value)}
              placeholder="e.g. RAMPUR01"
              autoComplete="off"
              autoCapitalize="characters"
              required
            />
          </label>

          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoComplete="name"
              required
            />
          </label>

          <label>
            6-digit PIN
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-hint">
          {mode === 'login'
            ? 'First time here? Choose Register to create your account with your school code.'
            : 'Ask your school admin for your school code. Choose a PIN you will remember.'}
        </p>
      </div>
    </div>
  );
}
