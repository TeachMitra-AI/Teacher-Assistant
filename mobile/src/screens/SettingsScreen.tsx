import React, { useState } from 'react';
import { View, Pressable, ScrollView, Switch, Image, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldCheck, LogOut, ChevronRight, CircleHelp, Camera, Trash2 } from 'lucide-react-native';
import type { AppStackParamList } from '../navigation/types';
import { ThemedText } from '../components/ThemedText';
import { TextField } from '../components/TextField';
import { SelectField } from '../components/SelectField';
import { OptionList } from '../components/OptionList';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { useProfilePicture } from '../lib/useProfilePicture';
import { spacing, radius } from '../theme/tokens';
import {
  ROLE_LABELS, LANGUAGES, GRADES, SUBJECTS, CLASSROOM_TYPES, RESPONSE_STYLES, AVATAR_PRESETS, HELP_SUPPORT_ENABLED, API_BASE,
} from '../config';
import { useSettingsScreen } from './useSettingsScreen';
import type { Role } from '../types';

type Props = NativeStackScreenProps<AppStackParamList, 'Settings'>;

// Reached from the header's profile avatar (ProfileMenu.tsx), matching the
// web's profile-dropdown "Settings" item → client/src/pages/SettingsPage.tsx.
// "Signed-in devices" and role-gated "Admin" live here as rows rather than
// their own dropdown entries — the web dropdown only has 4 items (Getting
// started/Settings/Need Help?/Sign out); this keeps that exact list intact
// while still surfacing routes that already existed under the old "More"
// tab (nothing removed, just relocated). Admin visibility mirrors App.tsx's
// ADMIN_ROLES check on web, against the real signed-in user's role.
//
// Custom profile-picture upload (useProfilePicture.ts) uses
// expo-image-picker — the one new native dependency this screen needed;
// see that file's header comment for how the "square crop" and
// "keep upload small" jobs the web version's canvas resize does are instead
// handled by the picker's own native editing UI.
//
// NOT ported from the web page: the "Appearance" card's theme toggle/
// text-size controls (theme already has an always-visible instant toggle in
// Header.tsx on every screen; mobile has no font-scaling system to hook a
// text-size control into — that would be a new, unrelated app-wide feature,
// not a port).
const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const NO_DEFAULT = { value: '', label: 'No default' };

export function SettingsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user, logout, updateUser } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const label = user ? user.displayName || user.name : '';
  const s = useSettingsScreen();
  const photo = useProfilePicture();
  const [photoError, setPhotoError] = useState('');

  async function handlePickPhoto() {
    setPhotoError('');
    const result = await photo.pickAndUpload();
    if (!result) return; // cancelled, or library access denied — nothing to show
    if ('error' in result) setPhotoError(result.error);
    else updateUser(result.user);
  }

  async function handleRemovePhoto() {
    setPhotoError('');
    const result = await photo.remove();
    if ('error' in result) setPhotoError(result.error);
    else updateUser(result.user);
  }

  // Picking an emoji and having a photo are mutually exclusive (a photo
  // always outranks an emoji wherever an avatar renders — see
  // ProfileMenu.tsx's AvatarCircle and this screen's identity card) — so
  // choosing an emoji while a photo is set clears the photo immediately,
  // the same way the dedicated Remove button does. Mirrors
  // client/src/pages/SettingsPage.tsx's handleAvatarEmojiSelected.
  async function handleAvatarEmojiSelected(emoji: string) {
    s.setAvatar(emoji);
    if (user?.avatarUrl) {
      setPhotoError('');
      const result = await photo.remove();
      if ('error' in result) setPhotoError(result.error);
      else updateUser(result.user);
    }
  }

  if (!user) return null;

  const photoUrl = user.avatarUrl ? `${API_BASE}${user.avatarUrl}` : null;
  const avatarEmoji = user.preferences?.avatar;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {/* .user-chip/.user-avatar: circular orange->amber gradient with
          initials (UI_REFINED.md §15), not three stacked text lines with no
          avatar. Role shown alongside name/email, matching .user-role.
          Precedence: custom photo > chosen emoji > initials — same as the
          header avatar (ProfileMenu.tsx's AvatarCircle) and User.avatarUrl's
          doc comment in types/index.ts. Reads `user.avatarUrl`/
          `user.preferences.avatar` directly (not the form's local `s.avatar`
          draft) — the photo tier updates the moment the upload/remove call
          above resolves; the emoji tier updates once "Save changes" below
          persists it, matching how the emoji is actually applied. */}
      <Card style={styles.identity}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.avatar} />
        ) : avatarEmoji ? (
          <View style={[styles.avatar, styles.avatarEmojiFallback, { backgroundColor: colors.surface2 }]}>
            <ThemedText style={styles.avatarEmoji}>{avatarEmoji}</ThemedText>
          </View>
        ) : (
          <LinearGradient
            colors={[colors.orange, colors.amber]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <ThemedText style={styles.avatarText}>{initials(label)}</ThemedText>
          </LinearGradient>
        )}
        <View style={styles.identityText}>
          <ThemedText variant="title">{label}</ThemedText>
          <ThemedText variant="muted">{ROLE_LABELS[user.role]}</ThemedText>
          <ThemedText variant="muted">{user.email}</ThemedText>
          <ThemedText variant="muted">{user.school.name}</ThemedText>
        </View>
      </Card>

      {/* Profile + teaching defaults */}
      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Profile</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>
          You sign in as {user.email} ({ROLE_LABELS[user.role]}) at {user.school.name}. Your sign-in email cannot be
          changed here — set a display name for how you appear in the app.
        </ThemedText>

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.fieldLabel}>Profile picture</ThemedText>
          <View style={styles.photoRow}>
            <Pressable
              onPress={handlePickPhoto}
              disabled={photo.uploading}
              accessibilityRole="button"
              accessibilityLabel={user.avatarUrl ? 'Change photo' : 'Upload photo'}
              style={[styles.photoPreview, { backgroundColor: colors.surface2, borderColor: colors.border }]}
            >
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.photoImg} />
              ) : (
                <ThemedText style={styles.photoPreviewEmoji}>{s.avatar || '🚫'}</ThemedText>
              )}
            </Pressable>
            <Pressable
              onPress={handlePickPhoto}
              disabled={photo.uploading}
              accessibilityRole="button"
              accessibilityLabel={user.avatarUrl ? 'Change photo' : 'Upload photo'}
              testID="settings-upload-photo"
              style={[styles.photoBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
            >
              {photo.uploading ? <ActivityIndicator color={colors.text} /> : <Camera size={18} color={colors.text} />}
            </Pressable>
            {!!user.avatarUrl && (
              <Pressable
                onPress={handleRemovePhoto}
                disabled={photo.uploading}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                testID="settings-remove-photo"
                style={[styles.photoBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              >
                <Trash2 size={18} color={colors.semantic.danger.action} />
              </Pressable>
            )}
          </View>
          {!!photoError && <ThemedText style={{ color: colors.semantic.danger.text }}>{photoError}</ThemedText>}
        </View>

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.fieldLabel}>Or choose an avatar</ThemedText>
          <View style={styles.avatarGrid}>
            <Pressable
              onPress={() => handleAvatarEmojiSelected('')}
              accessibilityRole="button"
              accessibilityLabel="No avatar"
              accessibilityState={{ selected: s.avatar === '' }}
              style={[styles.avatarOption, { borderColor: s.avatar === '' ? colors.orange : colors.border, backgroundColor: colors.surface2 }]}
            >
              <ThemedText style={styles.avatarOptionEmoji}>🚫</ThemedText>
            </Pressable>
            {AVATAR_PRESETS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => handleAvatarEmojiSelected(emoji)}
                accessibilityRole="button"
                accessibilityState={{ selected: s.avatar === emoji }}
                style={[styles.avatarOption, { borderColor: s.avatar === emoji ? colors.orange : colors.border, backgroundColor: colors.surface2 }]}
              >
                <ThemedText style={styles.avatarOptionEmoji}>{emoji}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <TextField label="Display name" value={s.displayName} onChangeText={s.setDisplayName} maxLength={60} placeholder={user.name} />

        <ThemedText variant="title" style={styles.subhead}>Teaching defaults</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>These pre-fill the Coach page so you don&apos;t have to pick them every time.</ThemedText>

        <SelectField label="Default language" options={[NO_DEFAULT, ...LANGUAGES]} value={s.defaultLanguage} onChange={s.setDefaultLanguage} />
        <SelectField label="Default grade" options={[NO_DEFAULT, ...GRADES.map((g) => ({ value: g, label: g }))]} value={s.defaultGrade} onChange={s.setDefaultGrade} />
        <SelectField label="Default subject" options={[NO_DEFAULT, ...SUBJECTS.map((sub) => ({ value: sub, label: sub }))]} value={s.defaultSubject} onChange={s.setDefaultSubject} />
        <SelectField label="Default classroom type" options={[NO_DEFAULT, ...CLASSROOM_TYPES.map((c) => ({ value: c, label: c }))]} value={s.defaultClassroomType} onChange={s.setDefaultClassroomType} />

        <OptionList label="Preferred response style" options={RESPONSE_STYLES} value={s.responseStyle} onChange={(v) => s.setResponseStyle(v as typeof s.responseStyle)} />

        {!!s.profileError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.profileError}</ThemedText>}
        {s.profileSaved && !s.profileError && <ThemedText style={{ color: colors.semantic.success.text }}>Settings saved</ThemedText>}
        <Button title={s.savingProfile ? 'Saving…' : 'Save changes'} onPress={s.saveProfile} loading={s.savingProfile} testID="settings-save-profile" />
      </Card>

      {/* Exam paper letterhead defaults */}
      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Quiz &amp; Worksheet paper details</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>
          Pre-fills the letterhead on generated quizzes and worksheets. Prefilled from your school/name below —
          override anything, or leave blank to leave it off the printed paper.
        </ThemedText>

        <TextField label="School name" value={s.examSchoolName} onChangeText={s.setExamSchoolName} maxLength={120} placeholder={user.school.name} />
        <TextField label="Teacher name (shown on paper)" value={s.examTeacherName} onChangeText={s.setExamTeacherName} maxLength={80} placeholder={user.displayName || user.name} />
        <TextField
          label="Default custom instructions"
          value={s.examInstructions}
          onChangeText={s.setExamInstructions}
          maxLength={500}
          multiline
          numberOfLines={2}
          placeholder="e.g. Use of calculator is not allowed."
        />

        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Show a Date field by default</ThemedText>
          <Switch value={s.examShowDate} onValueChange={s.setExamShowDate} testID="exam-show-date-switch" />
        </View>
        <View style={styles.row}>
          <ThemedText style={styles.rowLabel}>Show a Time/Duration field by default</ThemedText>
          <Switch value={s.examShowTime} onValueChange={s.setExamShowTime} testID="exam-show-time-switch" />
        </View>

        {!!s.examError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.examError}</ThemedText>}
        {s.examSaved && !s.examError && <ThemedText style={{ color: colors.semantic.success.text }}>Paper defaults saved</ThemedText>}
        <Button title={s.savingExamDefaults ? 'Saving…' : 'Save paper defaults'} onPress={s.saveExamDefaults} loading={s.savingExamDefaults} testID="settings-save-exam-defaults" />
      </Card>

      {/* Change password */}
      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Change password</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>
          Enter your current password, then choose a new one of at least 8 characters. If you have forgotten it,
          sign out and use the &ldquo;Forgot your password?&rdquo; link instead.
        </ThemedText>

        <TextField label="Current password" value={s.currentPassword} onChangeText={s.setCurrentPassword} isPassword maxLength={72} />
        <TextField label="New password" value={s.newPassword} onChangeText={s.setNewPassword} isPassword maxLength={72} />
        <TextField label="Confirm new password" value={s.confirmPassword} onChangeText={s.setConfirmPassword} isPassword maxLength={72} />

        {!!s.passwordError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.passwordError}</ThemedText>}
        {s.passwordSaved && !s.passwordError && <ThemedText style={{ color: colors.semantic.success.text }}>Password updated</ThemedText>}
        <Button
          title={s.savingPassword ? 'Updating…' : 'Update password'}
          onPress={s.savePassword}
          loading={s.savingPassword}
          disabled={s.savingPassword || !s.currentPassword || !s.newPassword || !s.confirmPassword}
          testID="settings-save-password"
        />
      </Card>

      {/* Grouped flat rows in one container with hairline dividers,
          matching .profile-dropdown/.profile-dropdown-item — not five
          separate elevated cards (UI_REFINED.md §15). */}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable onPress={() => navigation.navigate('Sessions')} style={styles.linkRow} accessibilityRole="button">
          <ThemedText style={styles.rowLabel}>Signed-in devices</ThemedText>
          <ChevronRight size={18} color={colors.textMuted} />
        </Pressable>
        {isAdmin && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Pressable onPress={() => navigation.navigate('Admin')} style={styles.linkRow} accessibilityRole="button">
              <ShieldCheck size={17} color={colors.text} />
              <ThemedText style={styles.rowLabel}>Admin</ThemedText>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          </>
        )}
        {HELP_SUPPORT_ENABLED && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Pressable onPress={() => navigation.navigate('HelpSupport')} style={styles.linkRow} accessibilityRole="button">
              <CircleHelp size={17} color={colors.text} />
              <ThemedText style={styles.rowLabel}>Need Help?</ThemedText>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          </>
        )}
      </View>

      <Pressable
        onPress={() => logout()}
        style={[styles.group, styles.signOutRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <LogOut size={17} color={colors.semantic.danger.action} />
        <ThemedText style={{ color: colors.semantic.danger.action, fontWeight: '600' }}>Sign out</ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  avatarEmojiFallback: { overflow: 'hidden' },
  avatarEmoji: { fontSize: 24 },
  identityText: { flex: 1, gap: 1 },
  card: { gap: spacing.md },
  cardTitle: { fontSize: 17 },
  subhead: { fontSize: 15, marginTop: spacing.xs },
  hint: { fontSize: 12, lineHeight: 17 },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  photoPreview: {
    width: 64, height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoPreviewEmoji: { fontSize: 28 },
  photoBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  avatarOption: {
    width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarOptionEmoji: { fontSize: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { flex: 1, fontSize: 15 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
  divider: { height: StyleSheet.hairlineWidth },
  signOutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 44 },
});
