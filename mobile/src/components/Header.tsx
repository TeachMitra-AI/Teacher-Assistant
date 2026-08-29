import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sun, Moon, SlidersHorizontal, PanelLeft } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { NotificationBell } from './NotificationBell';
import { ProfileAvatar } from './ProfileMenu';
import { useTheme } from '../theme/ThemeContext';
import { spacing, shadow } from '../theme/tokens';

interface HeaderProps {
  /** 'coach' swaps the profile avatar for the teaching-context filter icon,
   * matching the web header on the Coach page exactly. It also swaps the
   * left-side app icon/title for the history-sidebar toggle (onMenuPress)
   * — matching the web TopBar's onSidebarToggle, which hides its brand
   * block the same way (see client/src/components/TopBar.tsx). */
  variant?: 'default' | 'coach';
  /** Coach only — opens HistorySidebar.tsx. Set by CoachScreen.tsx via
   * navigation.setOptions (this component is rendered by the navigator, not
   * a CoachScreen child, so it has no other way to reach that state). */
  onMenuPress?: () => void;
  /** Coach only — opens TeachingContextMenu.tsx. Same navigation.setOptions
   * wiring as onMenuPress above. */
  onContextPress?: () => void;
  /** Coach only — count badge on the context icon (grade/subject/classroom/
   * focus currently set; language doesn't count, same as the web version —
   * see TeachingContextMenu.tsx). Zero/undefined shows no badge. */
  contextActiveCount?: number;
}

// Native port of the web's mobile header (client/src/components/TopBar.tsx)
// — app icon + name on the left (Coach: the chat-history sidebar toggle
// instead, matching TopBar hiding its own brand block there), theme toggle +
// notification bell + either the profile avatar or (Coach only) the
// teaching-context filter icon on the right. Used as every tab root screen's
// custom `header` (see each stack's options), replacing the native stack
// header so this exact layout is what renders instead of a bare title bar.
export function Header({ variant = 'default', onMenuPress, onContextPress, contextActiveCount = 0 }: HeaderProps) {
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
        {variant === 'coach' ? (
          <Pressable
            onPress={onMenuPress}
            accessibilityRole="button"
            accessibilityLabel="Open chat history"
            testID="coach-menu-button"
            style={[styles.iconButton, { backgroundColor: colors.surface2, borderColor: colors.border }]}
          >
            <PanelLeft size={18} color={colors.text} />
          </Pressable>
        ) : (
          <>
            <View style={[styles.logo, { backgroundColor: colors.orangeSoft }]}>
              <ThemedText style={styles.logoEmoji}>👨‍🏫</ThemedText>
            </View>
            <ThemedText style={styles.title}>शिक्षक सहायक</ThemedText>
          </>
        )}
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
            onPress={onContextPress}
            accessibilityRole="button"
            accessibilityLabel={contextActiveCount > 0 ? `Teaching context (${contextActiveCount} set)` : 'Teaching context'}
            testID="coach-context-button"
            style={[styles.iconButton, { backgroundColor: colors.surface2, borderColor: colors.border }]}
          >
            <SlidersHorizontal size={18} color={colors.text} />
            {contextActiveCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.orange, borderColor: colors.surface }]}>
                <ThemedText style={styles.badgeText}>{contextActiveCount}</ThemedText>
              </View>
            )}
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
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
