import React, { useState } from 'react';
import { View, Pressable, Modal, StyleSheet, Platform } from 'react-native';
import { Compass, Settings as SettingsIcon, CircleHelp, LogOut } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { spacing, radius, shadow } from '../theme/tokens';
import { navigationRef } from '../navigation/navigationRef';

// Native port of the web's `.profile-dropdown` (avatar in the header opens
// this) — Getting started / Settings / Need Help? / Sign out, same items and
// order as client/src/components/TopBar.tsx's profile menu. "Signed-in
// devices" and "Admin" are reachable from the Settings screen instead of
// this dropdown (kept off the web's 4-item list for visual parity; nothing
// lost — see SettingsScreen.tsx).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ProfileAvatar() {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const label = user.displayName || user.name;

  function go(screen: 'GettingStarted' | 'Settings' | 'HelpSupport') {
    setOpen(false);
    if (navigationRef.isReady()) navigationRef.navigate(screen);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        testID="header-avatar"
        style={[styles.avatar, { backgroundColor: colors.orange }]}
      >
        <ThemedText style={styles.avatarText}>{initials(label)}</ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close menu">
          <View
            style={[
              styles.menu,
              Platform.OS === 'ios' ? shadow.ios : shadow.android,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <MenuRow icon={Compass} label="Getting started" onPress={() => go('GettingStarted')} />
            <MenuRow icon={SettingsIcon} label="Settings" onPress={() => go('Settings')} />
            <MenuRow icon={CircleHelp} label="Need Help?" onPress={() => go('HelpSupport')} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <MenuRow
              icon={LogOut}
              label="Sign out"
              tone="danger"
              onPress={() => {
                setOpen(false);
                void logout();
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: typeof Compass;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.semantic.danger.action : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.row}
      hitSlop={4}
    >
      <Icon size={17} color={color} />
      <ThemedText style={{ color, fontWeight: '500' }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    top: 60,
    right: spacing.lg,
    minWidth: 200,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
});
