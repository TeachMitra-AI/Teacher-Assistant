import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sun, Moon, SlidersHorizontal } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { NotificationBell } from './NotificationBell';
import { ProfileAvatar } from './ProfileMenu';
import { useTheme } from '../theme/ThemeContext';
import { spacing, shadow } from '../theme/tokens';

interface HeaderProps {
  /** 'coach' swaps the profile avatar for the (currently inert) teaching-
   * context filter icon, matching the web header on the Coach page exactly
   * — see the icon's own comment for why it doesn't open anything yet. */
  variant?: 'default' | 'coach';
}

// Native port of the web's mobile header (client/src/components/TopBar.tsx)
// — app icon + name on the left, theme toggle + notification bell + either
// the profile avatar or (Coach only) the teaching-context filter icon on the
// right. Used as every tab root screen's custom `header` (see each stack's
// options), replacing the native stack header so this exact layout is what
// renders instead of a bare title bar.
export function Header({ variant = 'default' }: HeaderProps) {
  const { colors, mode, setOverride } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        Platform.OS === 'ios' ? shadow.ios : shadow.android,
        { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm },
      ]}
    >
      <View style={styles.left}>
        <View style={[styles.logo, { backgroundColor: colors.orangeSoft }]}>
          <ThemedText style={styles.logoEmoji}>👨‍🏫</ThemedText>
        </View>
        <ThemedText style={styles.title}>शिक्षक सहायक</ThemedText>
      </View>

      <View style={styles.right}>
        <Pressable
          onPress={() => setOverride(mode === 'dark' ? 'light' : 'dark')}
          accessibilityRole="button"
          accessibilityLabel={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          style={[styles.iconButton, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          {mode === 'dark' ? <Moon size={18} color={colors.text} /> : <Sun size={18} color={colors.text} />}
        </Pressable>

        <NotificationBell />

        {variant === 'coach' ? (
          <Pressable
            // Teaching-context filter (grade/subject/language) — the web's
            // TeachingContextMenu. Shown for header visual parity; not wired
            // up yet, matching CoachScreen.tsx's own documented Phase-4
            // scope boundary (no context picker on mobile this phase).
            accessibilityRole="button"
            accessibilityLabel="Teaching context filters"
            style={[styles.iconButton, { backgroundColor: colors.surface2, borderColor: colors.border }]}
          >
            <SlidersHorizontal size={18} color={colors.text} />
          </Pressable>
        ) : (
          <ProfileAvatar />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  logo: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logoEmoji: { fontSize: 15 },
  title: { fontWeight: '700', fontSize: 16, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
