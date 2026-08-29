// Notifications tab (Admin > Notifications, gated by NOTIFICATIONS_ENABLED
// one level up in AdminScreen.tsx, shown to every admin role). Native port
// of AdminNotificationsPage.tsx: a compose/broadcast form only — no sent-log
// view, matching the web page exactly. The scope picker offers only two
// shapes on purpose, same as web: "Everyone I can reach" (always sends
// { scope: 'all' }, clamped server-side to the caller's own reach) or
// "Specific role(s)" (also clamped server-side to the caller's own school
// scope) — a school-by-school or user-by-user picker is a natural extension
// the API already supports but isn't built here, matching the web v1 scope.
import React from 'react';
import { View, ScrollView, TextInput, StyleSheet } from 'react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { ChipPicker } from '../../../components/ChipPicker';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { ADMIN_SENDABLE_NOTIFICATION_TYPES, NOTIFICATION_TYPE_META } from '../../../config';
import { RoleCheckboxGroup } from '../RoleCheckboxGroup';
import { useAdminNotificationsScreen } from './useAdminNotificationsScreen';
import type { NotificationType, Role } from '../../../types';

// Reachable roles for a "specific role" send — every APP_ROLE, including
// teacher, matching AdminNotificationsPage.tsx's TARGET_ROLES exactly (an
// admin very often wants "every teacher", not every role).
const TARGET_ROLES: Role[] = ['teacher', 'school_admin', 'resource_person', 'super_admin'];

const TYPE_OPTIONS = ADMIN_SENDABLE_NOTIFICATION_TYPES.map((t) => ({ value: t, label: NOTIFICATION_TYPE_META[t].label }));
const SCOPE_OPTIONS = [
  { value: 'all', label: 'Everyone I can reach' },
  { value: 'role', label: 'Specific role(s)' },
];

export function AdminNotificationsScreen() {
  const { colors } = useTheme();
  const s = useAdminNotificationsScreen();

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Send a notification</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>
          Delivered instantly to every recipient who is online, and waiting in their notification center either way.
          Enforced on the server — this form can never reach further than your own role allows.
        </ThemedText>

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.label}>Title</ThemedText>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
            value={s.title}
            onChangeText={s.setTitle}
            maxLength={s.maxTitleLength}
            placeholder="e.g. Term 2 timetable is now live"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Title"
          />
        </View>

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.label}>Message</ThemedText>
          <TextInput
            style={[styles.input, styles.multiline, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
            value={s.message}
            onChangeText={s.setMessage}
            maxLength={s.maxMessageLength}
            placeholder="What do recipients need to know?"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            accessibilityLabel="Message"
          />
        </View>

        <ChipPicker label="Type" options={TYPE_OPTIONS} value={s.type} onChange={(v) => s.setType(v as NotificationType)} />

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.label}>Link (optional)</ThemedText>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
            value={s.link}
            onChangeText={s.setLink}
            placeholder="/admin"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            accessibilityLabel="Link"
          />
        </View>

        <ChipPicker label="Send to" options={SCOPE_OPTIONS} value={s.scope} onChange={(v) => s.setScope(v as 'all' | 'role')} />
        <ThemedText variant="muted" style={styles.hint}>
          {s.scope === 'all' ? s.reachDescription : 'Within your own reach, limited to the role(s) you pick below.'}
        </ThemedText>

        {s.scope === 'role' && (
          <RoleCheckboxGroup roles={TARGET_ROLES} value={s.roles} onToggle={s.toggleRole} />
        )}

        {!!s.submitError && <ThemedText style={{ color: colors.semantic.danger.text }}>{s.submitError}</ThemedText>}
        <Button title={s.submitting ? 'Sending…' : 'Send'} onPress={s.submit} loading={s.submitting} disabled={!s.canSubmit} testID="notifications-send" />

        {s.lastResult !== null && (
          <ThemedText variant="muted">Last send reached {s.lastResult} recipient{s.lastResult === 1 ? '' : 's'}.</ThemedText>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: { gap: spacing.md },
  cardTitle: { fontSize: 17 },
  hint: { fontSize: 12, lineHeight: 17 },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 48, fontSize: 15 },
  multiline: { minHeight: 96, paddingVertical: spacing.sm, textAlignVertical: 'top' },
});
