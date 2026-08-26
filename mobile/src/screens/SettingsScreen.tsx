import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldCheck, LogOut, ChevronRight } from 'lucide-react-native';
import type { AppStackParamList } from '../navigation/types';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { spacing, radius } from '../theme/tokens';
import { ROLE_LABELS } from '../config';
import type { Role } from '../types';

type Props = NativeStackScreenProps<AppStackParamList, 'Settings'>;

// Reached from the header's profile avatar (ProfileMenu.tsx), matching the
// web's profile-dropdown "Settings" item. "Signed-in devices" and
// role-gated "Admin" live here as rows rather than their own dropdown
// entries — the web dropdown only has 4 items (Getting started/Settings/
// Need Help?/Sign out); this keeps that exact list intact while still
// surfacing routes that already existed under the old "More" tab (nothing
// removed, just relocated). Admin visibility mirrors App.tsx's ADMIN_ROLES
// check on web, against the real signed-in user's role.
const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SettingsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const label = user ? user.displayName || user.name : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {user && (
        // .user-chip/.user-avatar: circular orange->amber gradient with
        // initials (UI_REFINED.md §15), not three stacked text lines with no
        // avatar. Role shown alongside name/email, matching .user-role.
        <Card style={styles.identity}>
          <LinearGradient
            colors={[colors.orange, colors.amber]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <ThemedText style={styles.avatarText}>{initials(label)}</ThemedText>
          </LinearGradient>
          <View style={styles.identityText}>
            <ThemedText variant="title">{label}</ThemedText>
            <ThemedText variant="muted">{ROLE_LABELS[user.role]}</ThemedText>
            <ThemedText variant="muted">{user.email}</ThemedText>
            <ThemedText variant="muted">{user.school.name}</ThemedText>
          </View>
        </Card>
      )}

      {/* Grouped flat rows in one container with hairline dividers,
          matching .profile-dropdown/.profile-dropdown-item — not five
          separate elevated cards (UI_REFINED.md §15). */}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable onPress={() => navigation.navigate('Sessions')} style={styles.row} accessibilityRole="button">
          <ThemedText style={styles.rowLabel}>Signed-in devices</ThemedText>
          <ChevronRight size={18} color={colors.textMuted} />
        </Pressable>
        {isAdmin && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Pressable onPress={() => navigation.navigate('Admin')} style={styles.row} accessibilityRole="button">
              <ShieldCheck size={17} color={colors.text} />
              <ThemedText style={styles.rowLabel}>Admin</ThemedText>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  identityText: { flex: 1, gap: 1 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
  rowLabel: { flex: 1, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth },
  signOutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 44 },
});
