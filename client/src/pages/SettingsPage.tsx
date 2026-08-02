import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useToast } from '../components/Toast';
import { useHelpSupport } from '../components/HelpSupport';
import { useAuth } from '../auth';
import { api, ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import {
  LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, RESPONSE_STYLES, AVATAR_PRESETS, ROLE_LABELS,
  HELP_SUPPORT_ENABLED,
} from '../config';
import type { ResponseStyle, TeacherPreferences, User } from '../types';

export default function SettingsPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { user, updateUser } = useAuth();
  const { show } = useToast();
  const { openMenu: openHelp } = useHelpSupport();
  const navigate = useNavigate();
  const { theme, toggleTheme, fontScale, changeFont, canIncrease, canDecrease } = preferences;

  const prefs = user?.preferences ?? {};
  const examDefaults = prefs.examPaperDefaults ?? {};

  // Profile + teaching defaults
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatar, setAvatar] = useState(prefs.avatar ?? '');
  const [defaultLanguage, setDefaultLanguage] = useState(prefs.defaultLanguage ?? '');
  const [defaultGrade, setDefaultGrade] = useState(prefs.defaultGrade ?? '');
  const [defaultSubject, setDefaultSubject] = useState(prefs.defaultSubject ?? '');
  const [defaultClassroomType, setDefaultClassroomType] = useState(prefs.defaultClassroomType ?? '');
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(prefs.responseStyle ?? 'balanced');
  const [savingProfile, setSavingProfile] = useState(false);

  // Exam-paper letterhead defaults (Quiz/Worksheet Generator) — prefilled
  // from the school/teacher identity the app already has, editable/overridable.
  const [examSchoolName, setExamSchoolName] = useState(examDefaults.schoolName ?? user?.school.name ?? '');
  const [examTeacherName, setExamTeacherName] = useState(examDefaults.teacherName ?? user?.displayName ?? user?.name ?? '');
  const [examInstructions, setExamInstructions] = useState(examDefaults.defaultInstructions ?? '');
  const [examShowDate, setExamShowDate] = useState(examDefaults.showDate ?? false);
  const [examShowTime, setExamShowTime] = useState(examDefaults.showTime ?? false);
  const [savingExamDefaults, setSavingExamDefaults] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

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
      // Preserved as-is — this form doesn't edit exam-paper defaults, and the
      // server does a shallow merge of the whole `preferences` object, so
      // omitting this key here would wipe it out otherwise.
      examPaperDefaults: prefs.examPaperDefaults,
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

  async function handleExamDefaultsSave(e: FormEvent) {
    e.preventDefault();
    setSavingExamDefaults(true);
    const preferencesPayload: TeacherPreferences = {
      // Preserved as-is for the same reason as above, mirrored.
      avatar: prefs.avatar,
      defaultLanguage: prefs.defaultLanguage,
      defaultGrade: prefs.defaultGrade,
      defaultSubject: prefs.defaultSubject,
      defaultClassroomType: prefs.defaultClassroomType,
      responseStyle: prefs.responseStyle,
      examPaperDefaults: {
        schoolName: examSchoolName.trim() || undefined,
        teacherName: examTeacherName.trim() || undefined,
        defaultInstructions: examInstructions.trim() || undefined,
        showDate: examShowDate,
        showTime: examShowTime,
      },
    };
    try {
      const res = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { preferences: preferencesPayload } });
      updateUser(res.user);
      show('Paper defaults saved', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save paper defaults', 'error');
    } finally {
      setSavingExamDefaults(false);
    }
  }

  async function handlePasswordSave(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      show('New password and confirmation do not match', 'error');
      return;
    }
    if (newPassword.length < 8) {
      show('New password must be at least 8 characters', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      await api('/auth/me/password', { method: 'PATCH', body: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      show('Password updated', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not update password', 'error');
    } finally {
      setSavingPassword(false);
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
            You sign in as <strong>{user.email}</strong> ({ROLE_LABELS[user.role]}) at {user.school.name}.
            Your sign-in email cannot be changed here — set a display name for how you appear in the app.
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

        {/* Exam paper letterhead defaults */}
        <form className="settings-card" onSubmit={handleExamDefaultsSave}>
          <h2>Quiz &amp; Worksheet paper details</h2>
          <p className="settings-hint">
            Pre-fills the letterhead on generated quizzes and worksheets. Prefilled from your school/name below —
            override anything, or leave blank to leave it off the printed paper.
          </p>

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="examSchool">School name</label>
              <input id="examSchool" className="text-input" type="text" maxLength={120}
                value={examSchoolName} onChange={(e) => setExamSchoolName(e.target.value)}
                placeholder={user.school.name} />
            </div>
            <div>
              <label className="field-label" htmlFor="examTeacher">Teacher name (shown on paper)</label>
              <input id="examTeacher" className="text-input" type="text" maxLength={80}
                value={examTeacherName} onChange={(e) => setExamTeacherName(e.target.value)}
                placeholder={user.displayName || user.name} />
            </div>
          </div>

          <label className="field-label" htmlFor="examInstructions">Default custom instructions</label>
          <textarea id="examInstructions" className="text-input" rows={2} maxLength={500}
            value={examInstructions} onChange={(e) => setExamInstructions(e.target.value)}
            placeholder="e.g. Use of calculator is not allowed." />

          <div className="settings-row">
            <span>Show a Date field by default</span>
            <input type="checkbox" checked={examShowDate} onChange={(e) => setExamShowDate(e.target.checked)} aria-label="Show a Date field by default" />
          </div>
          <div className="settings-row">
            <span>Show a Time/Duration field by default</span>
            <input type="checkbox" checked={examShowTime} onChange={(e) => setExamShowTime(e.target.checked)} aria-label="Show a Time/Duration field by default" />
          </div>

          <button className="btn-primary" type="submit" disabled={savingExamDefaults}>
            {savingExamDefaults ? 'Saving…' : 'Save paper defaults'}
          </button>
        </form>

        {/* Security */}
        <form className="settings-card" onSubmit={handlePasswordSave}>
          <h2>Change password</h2>
          <p className="settings-hint">
            Enter your current password, then choose a new one of at least 8 characters. If you have
            forgotten it, sign out and use the &ldquo;Forgot your password?&rdquo; link instead.
          </p>
          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="currentPassword">Current password</label>
              <input id="currentPassword" className="text-input" type="password" autoComplete="current-password"
                maxLength={72} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="newPassword">New password</label>
              <input id="newPassword" className="text-input" type="password" autoComplete="new-password"
                minLength={8} maxLength={72} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="confirmPassword">Confirm new password</label>
              <input id="confirmPassword" className="text-input" type="password" autoComplete="new-password"
                minLength={8} maxLength={72} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary" type="submit"
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}>
            {savingPassword ? 'Updating…' : 'Update password'}
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

        {/* Help & Support */}
        {HELP_SUPPORT_ENABLED && (
          <section className="settings-card">
            <h2>Help &amp; Support</h2>
            <p className="settings-hint">Report a bug, reach us directly, or share feedback.</p>
            <button className="btn-primary" type="button" onClick={openHelp}>Need Help?</button>
          </section>
        )}
      </main>
    </div>
  );
}
