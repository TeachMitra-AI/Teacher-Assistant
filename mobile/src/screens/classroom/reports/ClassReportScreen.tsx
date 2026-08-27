// "This Class" tab of the Reports screen (§26 Phase 11) — a read-only
// dashboard over the same GET /classroom/analytics/classes/:classId call
// Class Home's own summary strip already uses, so these numbers are the
// same aggregation by construction, never a second source of truth.
import React from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { BarChart3 } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/tokens';
import { formatMonthLabel } from '../../../lib/classroomDate';
import { useClassReportScreen } from './useClassReportScreen';
import { AttendanceSummaryBlock, FeeSummaryBlock } from './reportBlocks';

export function ClassReportScreen({ classId }: { classId: string }) {
  const { colors } = useTheme();
  const { analytics, loading, error, reload } = useClassReportScreen(classId);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.centerText}>Loading report…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && analytics && (
        <ScrollView contentContainerStyle={styles.scrollContent} testID="class-report-scroll">
          {analytics.totalStudents === 0 ? (
            <View style={styles.center} testID="class-report-empty-state">
              <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
                <BarChart3 size={26} color={colors.textMuted} strokeWidth={1.8} />
              </View>
              <ThemedText variant="title" style={styles.emptyTitle}>No active students</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>Add students to this class first, from the Students screen.</ThemedText>
            </View>
          ) : (
            <>
              <AttendanceSummaryBlock
                title={`Attendance — ${formatMonthLabel(analytics.month.month)}`}
                totalStudents={analytics.totalStudents}
                daysMarked={analytics.month.daysMarked}
                present={analytics.month.present}
                absent={analytics.month.absent}
                unmarked={analytics.month.unmarked}
                percentage={analytics.month.percentage}
              />
              <FeeSummaryBlock
                title={`Fees — ${formatMonthLabel(analytics.fees.period)}`}
                totalStudents={analytics.fees.totalStudents}
                paid={analytics.fees.paid}
                partial={analytics.fees.partial}
                pending={analytics.fees.pending}
                totalCollected={analytics.fees.totalCollected}
                totalExpected={analytics.fees.totalExpected}
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
