import React, { useState } from 'react';
import { View, Pressable, Modal, Image, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Compass, Settings as SettingsIcon, CircleHelp, LogOut } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { spacing, radius, shadow } from '../theme/tokens';
import { navigationRef } from '../navigation/navigationRef';
import { ROLE_LABELS, API_BASE } from '../config';

// Native port of the web's `.profile-dropdown` (client/src/components/
// ProfileMenu.tsx) — Getting started / Settings / Need Help? / Sign out,
// same items, order, and handlers regardless of `variant`; only the trigger
// and the menu's own positioning differ, same "one place owning the
// account-menu state" reasoning as the web version. 'header' (default) is
// the small circular avatar in Header.tsx's top-right corner (every tab
// except Coach, which has no profile control there — see Header.tsx's
// variant="coach" branch). 'sidebar' is the HistorySidebar.tsx footer row
// (Coach's chat-history drawer) — the mobile equivalent of the web's
// `<ProfileMenu variant="sidebar" />` in Sidebar.tsx's footer, using a
// bottom sheet instead of a small top-right dropdown since a footer-row
// trigger has nothing sensible above it to anchor a dropdown to. "Signed-in
// devices" and "Admin" are reachable from the Settings screen instead of
// this menu (kept off the web's 4-item list for visual parity; nothing lost
// — see SettingsScreen.tsx).
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Precedence: custom photo > chosen emoji > initials — same as the web's
// TopBar/ProfileMenu (client/src/components/ProfileMenu.tsx) and
// types/index.ts's User.avatarUrl doc comment.
function AvatarCircle({
  avatarUrl,
  emoji,
  label,
  size,
}: {
  avatarUrl?: string | null;
  emoji?: string;
  label: string;
  size: number;
}) {
  const { colors } = useTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (avatarUrl) {
    return <Image source={{ uri: `${API_BASE}${avatarUrl}` }} style={dimension} />;
  }
  if (emoji) {
    return (
      <View style={[dimension, styles.avatarFallback, { backgroundColor: colors.surface2 }]}>
        <ThemedText style={{ fontSize: size * 0.55 }}>{emoji}</ThemedText>
      </View>
    );
  }
  return (
    <View style={[dimension, styles.avatarFallback, { backgroundColor: colors.orange }]}>
      <ThemedText style={styles.avatarText}>{initials(label)}</ThemedText>
    </View>
  );
}

interface ProfileAvatarProps {
  variant?: 'header' | 'sidebar';
}

export function ProfileAvatar({ variant = 'header' }: ProfileAvatarProps) {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const label = user.displayName || user.name;

  function go(screen: 'GettingStarted' | 'Settings' | 'HelpSupport') {
    setOpen(false);
    if (navigationRef.isReady()) navigationRef.navigate(screen);
  }

  const menuItems = (
    <>
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
    </>
  );

  if (variant === 'sidebar') {
    return (
      <>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          testID="sidebar-account-row"
          style={[styles.sidebarRow, { borderTopColor: colors.border }]}
        >
          <AvatarCircle avatarUrl={user.avatarUrl} emoji={user.preferences?.avatar} label={label} size={34} />
          <View style={styles.sidebarRowText}>
            <ThemedText style={styles.sidebarRowName} numberOfLines={1}>{label}</ThemedText>
            <ThemedText variant="muted" style={styles.sidebarRowRole} numberOfLines={1}>{ROLE_LABELS[user.role]}</ThemedText>
          </View>
        </Pressable>

        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.sheetOverlay} onPress={() => setOpen(false)} accessibilityLabel="Close">
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.sheet,
                { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
              ]}
            >
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
              {menuItems}
            </Pressable>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        testID="header-avatar"
      >
        <AvatarCircle avatarUrl={user.avatarUrl} emoji={user.preferences?.avatar} label={label} size={34} />
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
            {menuItems}
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
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
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
  sidebarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  sidebarRowText: { flex: 1, gap: 1 },
  sidebarRowName: { fontSize: 14, fontWeight: '700' },
  sidebarRowRole: { fontSize: 12 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
});
