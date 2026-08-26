// Native port of client/src/pages/AdminPage.tsx's "Overview" tab — the
// role-scoped usage dashboard (KPIs, questions-over-time, subject/focus-
// area/language breakdowns, top questions) — reached from Settings' Admin
// row (role-gated there, same ADMIN_ROLES check). Real data only, from the
// existing GET /api/admin/analytics contract; no other AdminTabs section
// (Manage/Support/Notifications/Settings) is in scope for this pass — see
// docs/mobile-app-plan.md's Phase 7c "Newly approved features" note.
import React from 'react';
import { View, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { SummaryTile } from '../../components/SummaryTile';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { useAdminAnalyticsScreen } from './useAdminAnalyticsScreen';
import { HorizontalBarList } from './HorizontalBarList';
import { DailyTrendChart } from './DailyTrendChart';

export function AdminAnalyticsScreen() {
  const { colors } = useTheme();
  const { data, loading, error } = useAdminAnalyticsScreen();

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.orange} />
        <ThemedText variant="muted" style={styles.loadingText}>Loading analytics…</ThemedText>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ThemedText style={{ color: colors.semantic.danger.text }}>{error || 'Failed to load analytics.'}</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <ThemedText variant="title" style={styles.pageTitle}>Usage dashboard</ThemedText>

      <View style={styles.kpiGrid}>
        <SummaryTile label="Total questions" value={data.totals.queries} />
        <SummaryTile label="Teachers" value={data.totals.teachers} />
        <SummaryTile label="Active (30 days)" value={data.totals.activeTeachers} />
        <SummaryTile label="Feedback received" value={data.totals.feedback} />
        <SummaryTile
          label="Helpful rating"
          value={data.totals.helpfulRatio != null ? `${data.totals.helpfulRatio}%` : '—'}
        />
      </View>

      <Card style={styles.chartCard}>
        <ThemedText style={styles.chartTitle}>Questions over time</ThemedText>
        <DailyTrendChart data={data.byDay} color={colors.orange} />
      </Card>

      <Card style={styles.chartCard}>
        <ThemedText style={styles.chartTitle}>By subject</ThemedText>
        <HorizontalBarList data={data.bySubject} color={colors.orange} />
      </Card>

      <Card style={styles.chartCard}>
        <ThemedText style={styles.chartTitle}>By focus area</ThemedText>
        <HorizontalBarList data={data.byIssueType} color={colors.orange} />
      </Card>

      <Card style={styles.chartCard}>
        <ThemedText style={styles.chartTitle}>By language</ThemedText>
        <HorizontalBarList data={data.byLanguage} color={colors.orange} />
      </Card>

      <Card style={styles.chartCard}>
        <ThemedText style={styles.chartTitle}>Top questions</ThemedText>
        {data.topQuestions.length === 0 ? (
          <ThemedText variant="muted" style={styles.empty}>No data yet.</ThemedText>
        ) : (
          <View style={styles.topList}>
            {data.topQuestions.map((q, i) => (
              <View key={i} style={styles.topRow}>
                <ThemedText numberOfLines={2} style={styles.topText}>{q.question}</ThemedText>
                <ThemedText variant="muted" style={styles.topCount}>{q.count}</ThemedText>
              </View>
            ))}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { marginTop: spacing.xs },
  pageTitle: { fontSize: 20 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chartCard: { gap: spacing.sm },
  chartTitle: { fontSize: 15, fontWeight: '700' },
  empty: { fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
  topList: { gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  topText: { flex: 1, fontSize: 13 },
  topCount: { fontSize: 12, fontWeight: '600' },
});
