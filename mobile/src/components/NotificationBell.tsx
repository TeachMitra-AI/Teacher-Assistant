import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Bell } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { useNotifications } from '../notifications/NotificationContext';
import { navigationRef } from '../navigation/navigationRef';

// Native port of the web header's notification bell + badge
// (client/src/components/TopBar.tsx) — pushes the existing Notifications
// screen (already built, Phase 7) rather than the web's dropdown panel: a
// full-screen push is the native-idiomatic equivalent of a header dropdown
// on a phone-width screen, and reaches the exact same screen/data.
export function NotificationBell() {
  const { colors } = useTheme();
  const { unreadCount } = useNotifications();

  return (
    <Pressable
      onPress={() => navigationRef.isReady() && navigationRef.navigate('Notifications')}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      testID="header-notif-bell"
      style={[styles.button, { backgroundColor: colors.surface2, borderColor: colors.border }]}
    >
      <Bell size={18} color={colors.text} />
      {unreadCount > 0 && (
        <View style={[styles.badge, { backgroundColor: colors.orange, borderColor: colors.surface }]} testID="header-notif-badge">
          <ThemedText style={styles.badgeText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
