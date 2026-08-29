// Entry point for the Admin dashboard (reached from Settings' role-gated
// Admin row). Native port of the web's AdminTabs.tsx + its five page
// components (AdminPage/ManagePage/AdminSupportPage/AdminNotificationsPage/
// AdminSettingsPage), collapsed into one screen with a segmented sub-tab
// row — same "small tab switcher over a full child screen-component" shape
// as ReportsScreen.tsx's This Class/All Classes toggle, just horizontally
// scrollable since up to 5 tabs no longer fit a fixed-width row on a phone
// (the web version hits the identical problem below its own 640px
// breakpoint — see AdminTabs.tsx's header comment).
//
// Support and Settings are super_admin only, matching AdminTabs.tsx exactly.
// Notifications is gated by NOTIFICATIONS_ENABLED, same as the web tab.
import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { spacing, radius } from '../../theme/tokens';
import { NOTIFICATIONS_ENABLED } from '../../config';
import { AdminAnalyticsScreen } from './AdminAnalyticsScreen';
import { AdminManageScreen } from './manage/AdminManageScreen';
import { AdminSupportScreen } from './support/AdminSupportScreen';
import { AdminNotificationsScreen } from './notifications/AdminNotificationsScreen';
import { AdminSettingsScreen } from './settings/AdminSettingsScreen';

type AdminTab = 'overview' | 'manage' | 'support' | 'notifications' | 'settings';

type Props = NativeStackScreenProps<AppStackParamList, 'Admin'>;

export function AdminScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const tabs = useMemo(() => {
    const list: { key: AdminTab; label: string }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'manage', label: 'Manage' },
    ];
    if (isSuperAdmin) list.push({ key: 'support', label: 'Support' });
    if (NOTIFICATIONS_ENABLED) list.push({ key: 'notifications', label: 'Notifications' });
    if (isSuperAdmin) list.push({ key: 'settings', label: 'Settings' });
    return list;
  }, [isSuperAdmin]);

  const [tab, setTab] = useState<AdminTab>('overview');
  // If a role change (or the flag) removes the active tab from the list —
  // e.g. NOTIFICATIONS_ENABLED flips off mid-session — fall back to Overview
  // rather than rendering nothing.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        contentContainerStyle={styles.tabRowContent}
      >
        {tabs.map((t) => {
          const active = t.key === activeTab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && { backgroundColor: colors.surface }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`admin-tab-${t.key}`}
            >
              <ThemedText style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {activeTab === 'overview' && <AdminAnalyticsScreen />}
      {activeTab === 'manage' && <AdminManageScreen />}
      {activeTab === 'support' && <AdminSupportScreen navigation={navigation} />}
      {activeTab === 'notifications' && <AdminNotificationsScreen />}
      {activeTab === 'settings' && <AdminSettingsScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabRow: {
    flexGrow: 0, margin: spacing.lg, marginBottom: 0, padding: 3,
    borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
  },
  tabRowContent: { flexDirection: 'row', gap: 2 },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm - 2, alignItems: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabLabelActive: { fontWeight: '700' },
});
