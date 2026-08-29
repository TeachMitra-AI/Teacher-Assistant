// Settings tab (Admin > Settings, super_admin only — gated one level up in
// AdminScreen.tsx). Native port of AdminSettingsPage.tsx: lets a super_admin
// temporarily override existing env-var configuration at runtime, no
// redeploy needed. Two sections, driven by the same registry-backed list
// (GET /api/admin/feature-flags): Feature Management (boolean flags) and
// AI Access (role-list access controls).
import React from 'react';
import { View, ScrollView, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/tokens';
import { ROLE_LABELS } from '../../../config';
import { RoleCheckboxGroup } from '../RoleCheckboxGroup';
import { useAdminSettingsScreen } from './useAdminSettingsScreen';
import type { Role } from '../../../types';

// Every role the app has, for rendering the Assistant Access checkboxes —
// reuses config.ts's ROLE_LABELS, matching ManageUsersScreen.tsx's own
// ROLES vocabulary rather than declaring a second list here.
const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

export function AdminSettingsScreen() {
  const { colors } = useTheme();
  const s = useAdminSettingsScreen();

  if (!s.flags && !s.error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.orange} />
        <ThemedText variant="muted">Loading settings…</ThemedText>
      </View>
    );
  }

  if (s.error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ThemedText style={{ color: colors.semantic.danger.text }}>{s.error}</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>Feature Management</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>
          Temporarily turn a feature on or off for every teacher, without a deployment. Turning a flag off here never
          removes it from the server config — it&apos;s the same underlying kill switch, just reachable from here.
        </ThemedText>

        {s.featureFlags.map((flag) => (
          <View key={flag.id} style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText style={styles.rowLabel}>{flag.label}</ThemedText>
              {flag.source === 'env-default' && (
                <ThemedText variant="muted" style={styles.rowHint}>Using server default — no override set</ThemedText>
              )}
            </View>
            <Switch
              value={!!flag.enabled}
              disabled={s.pendingId === flag.id}
              onValueChange={() => s.toggleBoolean(flag)}
              testID={`feature-flag-${flag.id}`}
            />
          </View>
        ))}
      </Card>

      <Card style={styles.card}>
        <ThemedText variant="title" style={styles.cardTitle}>AI Access</ThemedText>
        <ThemedText variant="muted" style={styles.hint}>
          Choose which roles may use the AI Assistant. This is enforced on the server for every request — it is not
          just a UI preference. Leaving every role unchecked turns the Assistant off for everyone.
        </ThemedText>

        {s.accessControls.map((flag) => (
          <View key={flag.id} style={styles.accessSection}>
            <ThemedText variant="muted" style={styles.hint}>
              {flag.description}
              {flag.source === 'env-default' ? ' (using server default — no override set)' : ' (admin override active)'}
            </ThemedText>
            <RoleCheckboxGroup
              roles={ALL_ROLES}
              value={flag.roles ?? []}
              onToggle={(role) => s.toggleRole(flag, role)}
              disabled={s.pendingId === flag.id}
            />
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  card: { gap: spacing.md },
  cardTitle: { fontSize: 17 },
  hint: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontWeight: '600' },
  rowHint: { fontSize: 11 },
  accessSection: { gap: spacing.sm },
});
