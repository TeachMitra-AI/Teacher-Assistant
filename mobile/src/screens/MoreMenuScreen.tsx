import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../navigation/types';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { useMockRole } from '../auth/MockRoleContext';
import type { Role } from '../types';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreMenu'>;

// Notifications, Settings, Sessions/devices, Help & Support, and — role-gated
// — Admin (§10). Admin is hidden here using the same ADMIN_ROLES check
// App.tsx:59,82 does on web — ported against MockRoleContext for now
// (Phase 3 replaces it with the real signed-in user's role).
const MENU_ITEMS: { route: keyof MoreStackParamList; label: string }[] = [
  { route: 'Notifications', label: 'Notifications' },
  { route: 'Settings', label: 'Settings' },
  { route: 'Sessions', label: 'Signed-in devices' },
  { route: 'HelpSupport', label: 'Help & Support' },
];

const MOCK_ROLES: Role[] = ['teacher', 'school_admin', 'super_admin'];

export function MoreMenuScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { role, isAdmin, setRole } = useMockRole();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {MENU_ITEMS.map((item) => (
        <Pressable key={item.route} onPress={() => navigation.navigate(item.route)}>
          <Card style={styles.row}>
            <ThemedText>{item.label}</ThemedText>
          </Card>
        </Pressable>
      ))}
      {isAdmin && (
        <Pressable onPress={() => navigation.navigate('Admin')}>
          <Card style={styles.row}>
            <ThemedText>Admin</ThemedText>
          </Card>
        </Pressable>
      )}

      <Card style={styles.devCard}>
        <ThemedText variant="muted" style={styles.devLabel}>
          Dev-only role switch (Phase 2 stub — Phase 3 replaces this with real
          auth). Current role: {role}
        </ThemedText>
        <View style={styles.devRow}>
          {MOCK_ROLES.map((r) => (
            <Button key={r} title={r} variant={r === role ? 'primary' : 'secondary'} onPress={() => setRole(r)} />
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  row: { paddingVertical: 14 },
  devCard: { marginTop: 24, gap: 10 },
  devLabel: { fontSize: 12 },
  devRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
