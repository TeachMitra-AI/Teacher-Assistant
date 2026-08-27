// "All Classes" tab of the Reports screen (§26 Phase 11) — a read-only
// teacher-wide dashboard over GET /classroom/analytics/overview, the one
// figure no per-class screen shows: today's attendance summed across every
// class, not just the one Reports was opened from.
import React from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { BarChart3 } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/tokens';
import { formatMonthLabel } from '../../../lib/classroomDate';
import { useOverviewReportScreen } from './useOverviewReportScreen';
import { AttendanceSummaryBlock, FeeSummaryBlock } from './reportBlocks';

export function OverviewReportScreen() {
  const { colors } = useTheme();
  const { overview, loading, error, reload } = useOverviewReportScreen();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.centerText}>Loading overview…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && overview && (
        <ScrollView contentContainerStyle={styles.scrollContent} testID="overview-report-scroll">
          {overview.totalStudents === 0 ? (
            <View style={styles.center} testID="overview-report-empty-state">
              <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
                <BarChart3 size={26} color={colors.textMuted} strokeWidth={1.8} />
              </View>
              <ThemedText variant="title" style={styles.emptyTitle}>No active students yet</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>Add a class and some students to see your overview here.</ThemedText>
            </View>
          ) : (
            <>
              <AttendanceSummaryBlock
                title="Today — All Classes"
                totalStudents={overview.today.totalStudents}
                present={overview.today.present}
                absent={overview.today.absent}
                unmarked={overview.today.unmarked}
                percentage={overview.today.percentage}
              />
              <AttendanceSummaryBlock
                title={`${formatMonthLabel(overview.month.month)} — All Classes`}
                totalStudents={overview.month.totalStudents}
                daysMarked={overview.month.daysMarked}
                present={overview.month.present}
                absent={overview.month.absent}
                unmarked={overview.month.unmarked}
                percentage={overview.month.percentage}
              />
              <FeeSummaryBlock
                title={`Fees — ${formatMonthLabel(overview.fees.period)} — All Classes`}
                totalStudents={overview.fees.totalStudents}
                paid={overview.fees.paid}
                partial={overview.fees.partial}
                pending={overview.fees.pending}
                totalCollected={overview.fees.totalCollected}
                totalExpected={overview.fees.totalExpected}
              />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  centerText: { marginTop: spacing.xs },
  scrollContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
});
