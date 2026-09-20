// Entry point for Teacher Attendance (the bottom-nav tab between Classroom
// and Generator). Native port of the web's AttendancePage.tsx + its five
// child tab components (AttendanceTabs.tsx), collapsed into one screen. The
// tab row itself mirrors AttendanceTabs.tsx exactly — icon + label,
// horizontally scrollable, an orange underline on the active tab, not a
// pill/segmented control — verified directly against the web app's own
// mobile viewport rather than reusing this app's AdminScreen.tsx pattern.
//
// Reports/Activity Log/Settings are school_admin only, matching
// AttendancePage.tsx's own `isAdmin = user.role === 'school_admin'` check
// exactly — NOT this app's broader ADMIN_ROLES (which also includes
// resource_person/super_admin) used elsewhere for the unrelated Admin
// dashboard.
import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { CalendarCheck, History, BarChart3, ScrollText, Settings, type LucideIcon } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { spacing } from '../../theme/tokens';
import { CheckInScreen } from './CheckInScreen';
import { HistoryScreen } from './HistoryScreen';
import { ReportsScreen } from './ReportsScreen';
import { ActivityLogScreen } from './ActivityLogScreen';
import { AttendanceSettingsScreen } from './AttendanceSettingsScreen';

type AttendanceTab = 'checkin' | 'history' | 'reports' | 'activity' | 'settings';

export function AttendanceHomeScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const isAdmin = user?.role === 'school_admin';

  const tabs = useMemo(() => {
    const list: { key: AttendanceTab; label: string; icon: LucideIcon }[] = [
      { key: 'checkin', label: 'Check In', icon: CalendarCheck },
      { key: 'history', label: 'History', icon: History },
    ];
    if (isAdmin) {
      list.push(
        { key: 'reports', label: 'Reports', icon: BarChart3 },
        { key: 'activity', label: 'Activity Log', icon: ScrollText },
        { key: 'settings', label: 'Settings', icon: Settings }
      );
    }
    return list;
  }, [isAdmin]);

  const [tab, setTab] = useState<AttendanceTab>('checkin');
  // If a role change removes the active tab from the list, fall back to
  // Check In rather than rendering a tab the account can't act on — same
  // reasoning as AttendancePage.tsx's own fallback.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'checkin';

  const todayLabel = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <ThemedText variant="title" style={styles.title}>Attendance</ThemedText>
        <ThemedText variant="muted">{todayLabel}</ThemedText>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabRow, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.tabRowContent}
      >
        {tabs.map((t) => {
          const active = t.key === activeTab;
          const Icon = t.icon;
          const color = active ? colors.orange : colors.textMuted;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, { borderBottomColor: active ? colors.orange : 'transparent' }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`attendance-tab-${t.key}`}
            >
              <Icon size={15} color={color} />
              <ThemedText style={[styles.tabLabel, { color }]}>{t.label}</ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.content}>
        {activeTab === 'checkin' && <CheckInScreen />}
        {activeTab === 'history' && <HistoryScreen />}
        {activeTab === 'reports' && isAdmin && <ReportsScreen />}
        {activeTab === 'activity' && isAdmin && <ActivityLogScreen />}
        {activeTab === 'settings' && isAdmin && <AttendanceSettingsScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: 2 },
  title: { fontSize: 22 },
  tabRow: {
    flexGrow: 0, marginTop: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabRowContent: { flexDirection: 'row', paddingHorizontal: spacing.lg },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
  },
  tabLabel: { fontSize: 13, fontWeight: '600' },
});
