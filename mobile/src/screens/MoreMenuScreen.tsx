import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../navigation/types';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationContext';
import type { Role } from '../types';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreMenu'>;

// Notifications, Settings, Sessions/devices, Help & Support, and — role-gated
// — Admin (§10). Admin visibility mirrors App.tsx:59,82's ADMIN_ROLES check
// on web, now against the real signed-in user's role (Phase 3 replaces the
// Phase 2 MockRoleContext stub entirely, per its own file comment).
const ADMIN_ROLES: Role[] = ['school_admin', 'resource_person', 'super_admin'];

const MENU_ITEMS: { route: keyof MoreStackParamList; label: string }[] = [
  { route: 'Notifications', label: 'Notifications' },
  { route: 'Settings', label: 'Settings' },
  { route: 'Sessions', label: 'Signed-in devices' },
  { route: 'HelpSupport', label: 'Help & Support' },
];

export function MoreMenuScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {user && (
        <Card style={styles.identity}>
          <ThemedText variant="title">{user.displayName || user.name}</ThemedText>
          <ThemedText variant="muted">{user.email}</ThemedText>
          <ThemedText variant="muted">{user.school.name}</ThemedText>
        </Card>
      )}

      {MENU_ITEMS.map((item) => {
        const showBadge = item.route === 'Notifications' && unreadCount > 0;
        return (
          <Pressable key={item.route} onPress={() => navigation.navigate(item.route)}>
            <Card style={[styles.row, styles.rowContent]}>
              <ThemedText>{item.label}</ThemedText>
              {showBadge && (
                <View style={[styles.badge, { backgroundColor: colors.orange }]} testID="more-menu-notif-badge">
                  <ThemedText style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</ThemedText>
                </View>
              )}
            </Card>
          </Pressable>
        );
      })}
      {isAdmin && (
        <Pressable onPress={() => navigation.navigate('Admin')}>
          <Card style={styles.row}>
            <ThemedText>Admin</ThemedText>
          </Card>
        </Pressable>
      )}

      <Button title="Sign out" variant="secondary" onPress={() => logout()} style={styles.signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  identity: { gap: 2, marginBottom: 6 },
  row: { paddingVertical: 14 },
  rowContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  signOut: { marginTop: 24 },
});
