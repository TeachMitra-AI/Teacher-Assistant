import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import {
  LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, RESPONSE_STYLES, AVATAR_PRESETS, ROLE_LABELS,
} from '../config';
import type { ResponseStyle, TeacherPreferences, User } from '../types';

export default function SettingsPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { user, updateUser } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const { theme, toggleTheme, fontScale, changeFont, canIncrease, canDecrease } = preferences;

  const prefs = user?.preferences ?? {};

  // Profile + teaching defaults
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatar, setAvatar] = useState(prefs.avatar ?? '');
  const [defaultLanguage, setDefaultLanguage] = useState(prefs.defaultLanguage ?? '');
  const [defaultGrade, setDefaultGrade] = useState(prefs.defaultGrade ?? '');
  const [defaultSubject, setDefaultSubject] = useState(prefs.defaultSubject ?? '');
  const [defaultClassroomType, setDefaultClassroomType] = useState(prefs.defaultClassroomType ?? '');
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(prefs.responseStyle ?? 'balanced');
  const [savingProfile, setSavingProfile] = useState(false);

  // PIN change
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  if (!user) return null;

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    const preferencesPayload: TeacherPreferences = {
      avatar: avatar || undefined,
      defaultLanguage: defaultLanguage || undefined,
      defaultGrade: defaultGrade || undefined,
      defaultSubject: defaultSubject || undefined,
      defaultClassroomType: defaultClassroomType || undefined,
      responseStyle,
    };
    try {
      const res = await api<{ user: User }>('/auth/me', {
        method: 'PATCH',
        body: { displayName: displayName.trim() || null, preferences: preferencesPayload },
      });
      updateUser(res.user);
      show('Settings saved', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save settings', 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePinSave(e: FormEvent) {
    e.preventDefault();
    if (newPin !== confirmPin) {
      show('New PIN and confirmation do not match', 'error');
      return;
    }
    if (!/^\d{6}$/.test(newPin)) {
      show('New PIN must be exactly 6 digits', 'error');
      return;
    }
    setSavingPin(true);
    try {
      await api('/auth/me/pin', { method: 'PATCH', body: { currentPin, newPin } });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      show('PIN updated', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not update PIN', 'error');
    } finally {
      setSavingPin(false);
    }
  }

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="settings-main">
        <div className="settings-head">
          <h1 className="settings-title">Settings</h1>
          <button className="btn-text" onClick={() => navigate('/')}>← Back to Coach</button>
        </div>

        {/* Profile */}
        <form className="settings-card" onSubmit={handleProfileSave}>
          <h2>Profile</h2>
          <p className="settings-hint">
            You sign in as <strong>{user.name}</strong> ({ROLE_LABELS[user.role]}) at {user.school.name}.
            Your login name cannot be changed here — set a display name for how you appear in the app.
          </p>

          <label className="field-label">Avatar</label>
          <div className="avatar-grid" role="radiogroup" aria-label="Choose an avatar">
            <button
              type="button"
              className={`avatar-option${avatar === '' ? ' selected' : ''}`}
              onClick={() => setAvatar('')}
              aria-pressed={avatar === ''}
              title="No avatar"
            >
              🚫
            </button>
            {AVATAR_PRESETS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                className={`avatar-option${avatar === emoji ? ' selected' : ''}`}
                onClick={() => setAvatar(emoji)}
                aria-pressed={avatar === emoji}
              >
                {emoji}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            className="text-input"
            type="text"
            maxLength={60}
            placeholder={user.name}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <h3 className="settings-subhead">Teaching defaults</h3>
          <p className="settings-hint">These pre-fill the Coach page so you don't have to pick them every time.</p>

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="defLang">Default language</label>
              <select id="defLang" className="text-input" value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value)}>
                <option value="">No default</option>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="defGrade">Default grade</label>
              <select id="defGrade" className="text-input" value={defaultGrade} onChange={(e) => setDefaultGrade(e.target.value)}>
                <option value="">No default</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="defSubject">Default subject</label>
              <select id="defSubject" className="text-input" value={defaultSubject} onChange={(e) => setDefaultSubject(e.target.value)}>
                <option value="">No default</option>
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="defClassroom">Default classroom type</label>
              <select id="defClassroom" className="text-input" value={defaultClassroomType} onChange={(e) => setDefaultClassroomType(e.target.value)}>
                <option value="">No default</option>
                {CLASSROOM_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <label className="field-label">Preferred response style</label>
          <div className="style-grid" role="radiogroup" aria-label="Preferred response style">
            {RESPONSE_STYLES.map((s) => (
              <button
                type="button"
                key={s.value}
                className={`style-option${responseStyle === s.value ? ' selected' : ''}`}
                onClick={() => setResponseStyle(s.value)}
                aria-pressed={responseStyle === s.value}
              >
                <span className="style-label">{s.label}</span>
                <span className="style-hint">{s.hint}</span>
              </button>
            ))}
          </div>

          <button className="btn-primary" type="submit" disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        {/* Security */}
        <form className="settings-card" onSubmit={handlePinSave}>
          <h2>Change PIN</h2>
          <p className="settings-hint">Enter your current 6-digit PIN, then choose a new one.</p>
          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="currentPin">Current PIN</label>
              <input id="currentPin" className="text-input" type="password" inputMode="numeric" autoComplete="current-password"
                maxLength={6} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div>
              <label className="field-label" htmlFor="newPin">New PIN</label>
              <input id="newPin" className="text-input" type="password" inputMode="numeric" autoComplete="new-password"
                maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div>
              <label className="field-label" htmlFor="confirmPin">Confirm new PIN</label>
              <input id="confirmPin" className="text-input" type="password" inputMode="numeric" autoComplete="new-password"
                maxLength={6} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
          <button className="btn-primary" type="submit" disabled={savingPin || !currentPin || !newPin || !confirmPin}>
            {savingPin ? 'Updating…' : 'Update PIN'}
          </button>
        </form>

        {/* Appearance */}
        <section className="settings-card">
          <h2>Appearance</h2>
          <p className="settings-hint">These are saved on this device only.</p>
          <div className="settings-row">
            <span>Theme</span>
            <button className="btn-text" onClick={toggleTheme}>
              {theme === 'dark' ? '☀️ Switch to light' : '🌙 Switch to dark'}
            </button>
          </div>
          <div className="settings-row">
            <span>Text size ({fontScale}px)</span>
            <span className="font-controls">
              <button className="icon-btn" onClick={() => changeFont(-2)} disabled={!canDecrease} aria-label="Decrease text size">A−</button>
              <button className="icon-btn" onClick={() => changeFont(2)} disabled={!canIncrease} aria-label="Increase text size">A+</button>
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
