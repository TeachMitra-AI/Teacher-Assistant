// Owns Settings' form state/API orchestration (docs/mobile-app-plan.md Phase
// 7c's "Screen -> useXScreen() -> state/API/business rules -> UI"
// convention — see useClassListScreen.ts's identical shape). Mirrors
// client/src/pages/SettingsPage.tsx's three independent forms (profile +
// teaching defaults, exam-paper letterhead defaults, password) exactly,
// including which preference fields each PATCH preserves as-is so one form's
// save can never silently wipe another's — same shallow-merge caveat the
// web version documents. No toast system on mobile (see CoachScreen.tsx's
// established precedent) — a brief inline "Saved" replaces it, cleared the
// moment a new save starts.
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { ResponseStyle, TeacherPreferences, User } from '../types';

export function useSettingsScreen() {
  const { user, updateUser } = useAuth();
  const prefs = user?.preferences ?? {};
  const examDefaults = prefs.examPaperDefaults ?? {};

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatar, setAvatar] = useState(prefs.avatar ?? '');
  const [defaultLanguage, setDefaultLanguage] = useState(prefs.defaultLanguage ?? '');
  const [defaultGrade, setDefaultGrade] = useState(prefs.defaultGrade ?? '');
  const [defaultSubject, setDefaultSubject] = useState(prefs.defaultSubject ?? '');
  const [defaultClassroomType, setDefaultClassroomType] = useState(prefs.defaultClassroomType ?? '');
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(prefs.responseStyle ?? 'balanced');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const [examSchoolName, setExamSchoolName] = useState(examDefaults.schoolName ?? user?.school.name ?? '');
  const [examTeacherName, setExamTeacherName] = useState(examDefaults.teacherName ?? user?.displayName ?? user?.name ?? '');
  const [examInstructions, setExamInstructions] = useState(examDefaults.defaultInstructions ?? '');
  const [examShowDate, setExamShowDate] = useState(examDefaults.showDate ?? false);
  const [examShowTime, setExamShowTime] = useState(examDefaults.showTime ?? false);
  const [savingExamDefaults, setSavingExamDefaults] = useState(false);
  const [examError, setExamError] = useState('');
  const [examSaved, setExamSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    setProfileError('');
    setProfileSaved(false);
    const preferencesPayload: TeacherPreferences = {
      avatar: avatar || undefined,
      defaultLanguage: defaultLanguage || undefined,
      defaultGrade: defaultGrade || undefined,
      defaultSubject: defaultSubject || undefined,
      defaultClassroomType: defaultClassroomType || undefined,
      responseStyle,
      // Preserved as-is — this form doesn't edit exam-paper defaults, and
      // the server does a shallow merge of the whole `preferences` object,
      // so omitting this key here would wipe it out otherwise.
      examPaperDefaults: prefs.examPaperDefaults,
    };
    try {
      const res = await api<{ user: User }>('/auth/me', {
        method: 'PATCH',
        body: { displayName: displayName.trim() || null, preferences: preferencesPayload },
      });
      updateUser(res.user);
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveExamDefaults() {
    setSavingExamDefaults(true);
    setExamError('');
    setExamSaved(false);
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
      setExamSaved(true);
    } catch (err) {
      setExamError(err instanceof ApiError ? err.message : 'Could not save paper defaults.');
    } finally {
      setSavingExamDefaults(false);
    }
  }

  async function savePassword() {
    setPasswordSaved(false);
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    setSavingPassword(true);
    setPasswordError('');
    try {
      await api('/auth/me/password', { method: 'PATCH', body: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Could not update password.');
    } finally {
      setSavingPassword(false);
    }
  }

  return {
    displayName, setDisplayName,
    avatar, setAvatar,
    defaultLanguage, setDefaultLanguage,
    defaultGrade, setDefaultGrade,
    defaultSubject, setDefaultSubject,
    defaultClassroomType, setDefaultClassroomType,
    responseStyle, setResponseStyle,
    savingProfile, profileError, profileSaved, saveProfile,

    examSchoolName, setExamSchoolName,
    examTeacherName, setExamTeacherName,
    examInstructions, setExamInstructions,
    examShowDate, setExamShowDate,
    examShowTime, setExamShowTime,
    savingExamDefaults, examError, examSaved, saveExamDefaults,

    currentPassword, setCurrentPassword,
    newPassword, setNewPassword,
    confirmPassword, setConfirmPassword,
    savingPassword, passwordError, passwordSaved, savePassword,
  };
}
