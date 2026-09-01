// Reports screen — native port of client/src/components/classroom/
// ReportsPanel.tsx (the web app's "Reports" classroom tab), replacing the
// earlier mobile-only "This Class"/"All Classes" segmented Attendance+Fees
// summary (no web equivalent existed for that; see git history). The web
// Reports tab is fees-only and always scoped to one class — this mirrors
// that exactly: a month navigator + Excel export, a plain Fees summary
// (Expected/Collected/Pending), five tappable filter tiles that open a
// student-list drill-down (FeeStatusModal), and a persistent list of
// students who still owe money this month. Reuses getFeeStatus — the same
// call the Fees tab already makes — so these numbers can never drift from
// what a teacher sees there.
import React, { useState } from 'react';
import { View, ScrollView, FlatList, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChevronLeft, ChevronRight, ChevronDown, Download, FileBarChart } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../../navigation/types';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { useTheme } from '../../../theme/ThemeContext';
import type { ThemeColors } from '../../../theme/tokens';
import { spacing, radius } from '../../../theme/tokens';
import { formatMonthLabel } from '../../../lib/classroomDate';
import { feeBadgeText, isOverpaid, FEE_STATUS_LABEL } from '../../../lib/feeBadge';
import { sortByRollNumber } from '../../../lib/students';
import { useReportsScreen, type TileFilter } from './useReportsScreen';
import { FeeStatusModal } from './FeeStatusModal';
import type { StudentFeeStatus } from '../../../types';

type Props = NativeStackScreenProps<ClassroomStackParamList, 'Reports'>;

type TileTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'info';

function tileToneColor(tone: TileTone, colors: ThemeColors): string | undefined {
  if (tone === 'positive') return colors.semantic.success.text;
  if (tone === 'warning') return colors.semantic.warning.text;
  if (tone === 'negative') return colors.semantic.danger.text;
  if (tone === 'info') return colors.orange;
  return undefined;
}

function FilterTile({
  label, value, tone, selected, onPress, accessibilityLabel,
}: {
  label: string; value: number; tone: TileTone; selected: boolean; onPress: () => void; accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const toneColor = tileToneColor(tone, colors);
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.filterTile,
        { backgroundColor: colors.surface, borderColor: selected ? colors.orange : colors.border },
        selected && { backgroundColor: colors.orangeSoft },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
    >
      <ThemedText style={[styles.filterTileValue, toneColor ? { color: toneColor } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </ThemedText>
      <ThemedText variant="muted" style={styles.filterTileLabel} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </ThemedText>
      <ChevronDown size={13} color={colors.textMuted} />
    </Pressable>
  );
}

export function ReportsScreen({ route }: Props) {
  const { colors } = useTheme();
  const { classId } = route.params;
  const {
    period, board, loading, error, downloading, selectedFilter,
    goToPreviousMonth, goToNextMonth, setSelectedFilter, download, reload,
  } = useReportsScreen(classId);
  const [downloadError, setDownloadError] = useState('');

  async function handleDownload() {
    setDownloadError('');
    try {
      await download();
    } catch {
      // No toast system on mobile; a native alert mirrors the web's
      // show(..., 'error') for this rare, one-off failure closely enough.
      Alert.alert('Could not download', 'Could not download the fee report. Please try again.');
    }
  }

  const owing = board ? sortByRollNumber(board.perStudent.filter((s) => s.status !== 'paid')) : [];
  const overpaidCount = board ? board.perStudent.filter(isOverpaid).length : 0;

  const tileDefs: { filter: TileFilter; value: number; label: string; tone: TileTone; accessibilityLabel: string }[] = board
    ? [
        { filter: 'all', value: board.totalStudents, label: 'Total Students', tone: 'neutral', accessibilityLabel: 'Show all students' },
        { filter: 'paid', value: board.paid, label: 'Paid', tone: 'positive', accessibilityLabel: 'Show paid students' },
        { filter: 'partial', value: board.partial, label: 'Partial', tone: 'warning', accessibilityLabel: 'Show partially paid students' },
        { filter: 'pending', value: board.pending, label: 'Pending', tone: 'negative', accessibilityLabel: 'Show pending students' },
        { filter: 'overpaid', value: overpaidCount, label: 'Overpaid', tone: 'info', accessibilityLabel: 'Show overpaid students' },
      ]
    : [];

  const modalStudents: StudentFeeStatus[] =
    selectedFilter === null || !board
      ? []
      : selectedFilter === 'all'
        ? sortByRollNumber(board.perStudent)
        : selectedFilter === 'overpaid'
          ? sortByRollNumber(board.perStudent.filter(isOverpaid))
          : sortByRollNumber(board.perStudent.filter((s) => s.status === selectedFilter));

  const modalTitle =
    selectedFilter === 'all'
      ? 'All students'
      : selectedFilter === 'overpaid'
        ? 'Students who overpaid'
        : selectedFilter
          ? `Students marked ${FEE_STATUS_LABEL[selectedFilter].toLowerCase()}`
          : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.monthNav}>
        <Pressable
          onPress={goToPreviousMonth}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ChevronLeft size={18} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.monthLabel}>{formatMonthLabel(period)}</ThemedText>
        <Pressable
          onPress={goToNextMonth}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ChevronRight size={18} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={handleDownload}
          disabled={downloading || loading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Download this month's fee report as an Excel file"
          testID="reports-download"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }, (downloading || loading) && styles.navBtnDisabled]}
        >
          {downloading ? <ActivityIndicator size="small" color={colors.text} /> : <Download size={18} color={colors.text} />}
        </Pressable>
      </View>
      {!!downloadError && <ThemedText style={{ color: colors.semantic.danger.text }}>{downloadError}</ThemedText>}

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

      {!loading && !error && board && (
        <ScrollView contentContainerStyle={styles.scroll} testID="reports-scroll">
          <View style={styles.section}>
            <ThemedText variant="title" style={styles.sectionTitle}>Fees</ThemedText>
            <SummaryTileRow>
              <SummaryTile label="Expected" value={`₹${board.totalExpected}`} />
              <SummaryTile label="Collected" value={`₹${board.totalCollected}`} tone="positive" />
              <SummaryTile label="Pending" value={`₹${board.totalPending}`} tone="negative" />
            </SummaryTileRow>
          </View>

          <View style={styles.filterRow}>
            {tileDefs.map((t) => (
              <FilterTile
                key={t.filter}
                label={t.label}
                value={t.value}
                tone={t.tone}
                selected={selectedFilter === t.filter}
                accessibilityLabel={t.accessibilityLabel}
                onPress={() => setSelectedFilter(selectedFilter === t.filter ? null : t.filter)}
              />
            ))}
          </View>

          {owing.length === 0 ? (
            <View style={styles.center} testID="reports-empty-state">
              <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
                <FileBarChart size={26} color={colors.textMuted} strokeWidth={1.8} />
              </View>
              <ThemedText variant="title" style={styles.emptyTitle}>Everyone&apos;s paid up</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>No student owes money for {formatMonthLabel(period)}.</ThemedText>
            </View>
          ) : (
            <View style={styles.section}>
              <ThemedText variant="muted" style={styles.hint}>Students who still owe money this month:</ThemedText>
              <FlatList
                data={owing}
                keyExtractor={(s) => s.studentId}
                scrollEnabled={false}
                contentContainerStyle={styles.list}
                testID="reports-owing-list"
                renderItem={({ item }) => (
                  <View style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                    <View style={styles.rowText}>
                      <ThemedText style={styles.name}>{item.name}</ThemedText>
                      {item.rollNumber && <ThemedText variant="muted" style={styles.roll}>Roll {item.rollNumber}</ThemedText>}
                    </View>
                    <ThemedText variant="muted" style={styles.badge}>{feeBadgeText(item)}</ThemedText>
                  </View>
                )}
              />
            </View>
          )}
        </ScrollView>
      )}

      <FeeStatusModal
        visible={selectedFilter !== null}
        title={modalTitle}
        period={period}
        students={modalStudents}
        onClose={() => setSelectedFilter(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  navBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.4 },
  monthLabel: { fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  centerText: { marginTop: spacing.xs },
  scroll: { gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 15 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterTile: {
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 2,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
  },
  filterTileValue: { fontSize: 22, fontWeight: '700' },
  filterTileLabel: { fontSize: 12, textAlign: 'center' },
  hint: { fontSize: 13 },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  roll: { fontSize: 12 },
  badge: { fontSize: 13, fontWeight: '600', textAlign: 'right' },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
});
