// Entry point for the Reports stack screen (§26 Phase 11, §12). A small
// segmented control, not another pushed screen — "This Class" and "All
// Classes" are two different scopes over related data, exactly matching
// AttendanceScreen.tsx's own Mark/Monthly segmented control precedent.
// Net-new UI: no web equivalent exists to port (docs/mobile-app-plan.md
// §11's screen map: "Classroom → Reports ... Net-new UI, backend already
// exists").
import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ClassroomStackParamList } from '../../../navigation/types';
import { ThemedText } from '../../../components/ThemedText';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { ClassReportScreen } from './ClassReportScreen';
import { OverviewReportScreen } from './OverviewReportScreen';

type ReportsView = 'class' | 'overview';

type Props = NativeStackScreenProps<ClassroomStackParamList, 'Reports'>;

export function ReportsScreen({ route }: Props) {
  const { colors } = useTheme();
  const { classId } = route.params;
  const [view, setView] = useState<ReportsView>('class');

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.tabRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Pressable
          onPress={() => setView('class')}
          style={[styles.tab, view === 'class' && { backgroundColor: colors.surface }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'class' }}
          testID="reports-tab-class"
        >
          <ThemedText style={[styles.tabLabel, view === 'class' && styles.tabLabelActive]}>This Class</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setView('overview')}
          style={[styles.tab, view === 'overview' && { backgroundColor: colors.surface }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'overview' }}
          testID="reports-tab-overview"
        >
          <ThemedText style={[styles.tabLabel, view === 'overview' && styles.tabLabelActive]}>All Classes</ThemedText>
        </Pressable>
      </View>

      {view === 'class' ? <ClassReportScreen classId={classId} /> : <OverviewReportScreen />}
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
