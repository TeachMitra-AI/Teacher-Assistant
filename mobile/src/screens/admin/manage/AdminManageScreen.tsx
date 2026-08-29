// Manage tab (Admin > Manage) — sub-tab switcher over Schools/Pending
// teachers/Users, each its own full screen-component rather than the web's
// three stacked sections on one page (a phone can't comfortably scroll past
// three independent searchable/filterable tables at once). Same segmented
// sub-tab shape as AdminScreen.tsx's own top-level tabs and
// ReportsScreen.tsx's This Class/All Classes toggle.
//
// Schools is super_admin only, matching ManagePage.tsx's `isSuperAdmin` gate
// on web exactly.
import React, { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '../../../components/ThemedText';
import { useTheme } from '../../../theme/ThemeContext';
import { useAuth } from '../../../auth/AuthContext';
import { spacing, radius } from '../../../theme/tokens';
import { ManageSchoolsScreen } from './ManageSchoolsScreen';
import { ManagePendingScreen } from './ManagePendingScreen';
import { ManageUsersScreen } from './ManageUsersScreen';

type ManageTab = 'schools' | 'pending' | 'users';

export function AdminManageScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const tabs = useMemo(() => {
    const list: { key: ManageTab; label: string }[] = [];
    if (isSuperAdmin) list.push({ key: 'schools', label: 'Schools' });
    list.push({ key: 'pending', label: 'Pending' }, { key: 'users', label: 'Users' });
    return list;
  }, [isSuperAdmin]);

  const [tab, setTab] = useState<ManageTab>(isSuperAdmin ? 'schools' : 'pending');
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  return (
    <View style={styles.container}>
      <View style={[styles.tabRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        {tabs.map((t) => {
          const active = t.key === activeTab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && { backgroundColor: colors.surface }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`manage-tab-${t.key}`}
            >
              <ThemedText style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {activeTab === 'schools' && <ManageSchoolsScreen />}
      {activeTab === 'pending' && <ManagePendingScreen />}
      {activeTab === 'users' && <ManageUsersScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabRow: {
    flexDirection: 'row', margin: spacing.lg, marginBottom: 0, padding: 3,
    borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm - 2, alignItems: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabLabelActive: { fontWeight: '700' },
});
