// Native port of client/src/components/attendance/ReportsTab.tsx —
// school_admin only. Landing view: today's stat cards + a paginated,
// searchable, sortable list of every teacher's monthly counts. Tapping a
// teacher opens their own drill-down: 6-month trend strip, this month's
// calendar strip, and a day-by-day list with an on-demand "Correct" action.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, AlertTriangle, Search, Download, Pencil } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { SummaryTile, SummaryTileRow } from '../../components/SummaryTile';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import {
  getSchoolHistory, getTeacherAttendanceDetail, getSchoolConfig, getHolidays, getTodaySummary,
  downloadSchoolAttendanceReport,
} from '../../api/teacherAttendanceApi';
import { addMonths, currentMonthString, formatMonthLabel, todayDateString } from '../../lib/classroomDate';
import {
  buildMonthDates, sinceDateFor, buildRows, summarizeRows, formatSummary, type HistoryRow, type HistorySummary,
} from '../../lib/teacherAttendanceCalendar';
import { AttendanceCalendarStrip } from './AttendanceCalendarStrip';
import { AttendanceHistoryRow } from './AttendanceHistoryRow';
import { AttendanceCorrectionForm } from './AttendanceCorrectionForm';
import { AttendanceReportsTable, type SortKey } from './AttendanceReportsTable';
import type {
  SchoolHistoryTeacherSummary, TeacherAttendanceDetailDto, TeacherAttendanceTodaySummary,
  SchoolAttendanceConfigDto, SchoolHolidayDto,
} from '../../types';

const TREND_MONTHS = 6;
const CURRENT_MONTH = currentMonthString();
const PAGE_SIZE = 25;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function monthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short' });
}

export function ReportsScreen() {
  const { colors } = useTheme();
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [teachers, setTeachers] = useState<SchoolHistoryTeacherSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const [config, setConfig] = useState<SchoolAttendanceConfigDto | null>(null);
  const [holidays, setHolidays] = useState<SchoolHolidayDto[]>([]);
  const [todaySummary, setTodaySummary] = useState<TeacherAttendanceTodaySummary | null>(null);

  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [detailRecords, setDetailRecords] = useState<TeacherAttendanceDetailDto[]>([]);
  const [detailTeacher, setDetailTeacher] = useState<{ id: string; name: string; email: string; createdAt: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [correctingDate, setCorrectingDate] = useState<string | null>(null);

  const [trend, setTrend] = useState<{ month: string; count: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [listData, schoolConfig, holidayList] = await Promise.all([
        getSchoolHistory(month, { page, pageSize: PAGE_SIZE, search: search.trim() || undefined }),
        getSchoolConfig(),
        getHolidays(),
      ]);
      setTeachers(listData.teachers);
      setTotal(listData.total);
      setConfig(schoolConfig);
      setHolidays(holidayList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the school report.');
    } finally {
      setLoading(false);
    }
  }, [month, page, search]);

  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    getTodaySummary().then(setTodaySummary).catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [month, search]);

  const needsLookCount = useMemo(
    () => teachers.filter((t) => t.summary.flagged_review > 0 || t.summary.pending_regularization > 0).length,
    [teachers]
  );

  const filtered = useMemo(() => {
    if (!onlyFlagged) return teachers;
    return teachers.filter((t) => t.summary.flagged_review > 0 || t.summary.pending_regularization > 0);
  }, [teachers, onlyFlagged]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = sortKey === 'name' ? a.name.localeCompare(b.name) : a.summary[sortKey] - b.summary[sortKey];
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc'); // counts: biggest first is usually what you want first
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadSchoolAttendanceReport(month);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : 'Could not download the report.');
    } finally {
      setDownloading(false);
    }
  }

  const loadDetail = useCallback(async (teacherId: string) => {
    setDetailLoading(true);
    setDetailError('');
    setCorrectingDate(null);
    try {
      const data = await getTeacherAttendanceDetail(teacherId, month);
      setDetailTeacher(data.teacher);
      setDetailRecords(data.records);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Could not load this teacher's attendance.");
    } finally {
      setDetailLoading(false);
    }
  }, [month]);

  const loadTrend = useCallback(async (teacherId: string) => {
    setTrendLoading(true);
    try {
      const months = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(month, -(TREND_MONTHS - 1 - i)));
      const results = await Promise.all(months.map((m) => getTeacherAttendanceDetail(teacherId, m).catch(() => null)));
      setTrend(
        months.map((m, i) => {
          const records = results[i]?.records ?? [];
          const count = records.filter((r) => (r.lateMinutes ?? 0) > 0 || (r.checkInAt && !r.checkOutAt)).length;
          return { month: m, count };
        })
      );
    } finally {
      setTrendLoading(false);
    }
  }, [month]);

  function openTeacher(teacherId: string) {
    setSelectedTeacherId(teacherId);
    void loadDetail(teacherId);
    void loadTrend(teacherId);
  }

  function backToAllTeachers() {
    setSelectedTeacherId(null);
    setDetailTeacher(null);
    setDetailRecords([]);
    setTrend([]);
    setCorrectingDate(null);
  }

  function handleCorrected() {
    setCorrectingDate(null);
    if (selectedTeacherId) {
      void loadDetail(selectedTeacherId);
      void loadTrend(selectedTeacherId);
    }
    void load();
    getTodaySummary().then(setTodaySummary).catch(() => {});
  }

  const detailRows: HistoryRow[] = useMemo(() => {
    if (!detailTeacher) return [];
    const dates = config
      ? buildMonthDates(month, todayDateString(), sinceDateFor(config, detailTeacher.createdAt))
      : detailRecords.map((r) => r.date);
    return buildRows(dates, detailRecords, config, holidays);
  }, [detailTeacher, detailRecords, config, holidays, month]);

  const detailSummary: HistorySummary | null = detailTeacher ? summarizeRows(detailRows) : null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const patternThreshold = config?.repeatPatternThreshold ?? 1;
  const trendMax = Math.max(1, ...trend.map((t) => t.count));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => setMonth((m) => addMonths(m, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ChevronLeft size={18} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.navLabel}>{formatMonthLabel(month)}</ThemedText>
        <Pressable
          onPress={() => setMonth((m) => addMonths(m, 1))}
          disabled={month >= CURRENT_MONTH}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }, month >= CURRENT_MONTH && styles.navBtnDisabled]}
        >
          <ChevronRight size={18} color={month >= CURRENT_MONTH ? colors.textMuted : colors.text} />
        </Pressable>
      </View>

      {loading && (
        <View style={styles.center}><ActivityIndicator color={colors.orange} /></View>
      )}

      {!loading && !!error && (
        <View style={[styles.banner, { backgroundColor: colors.semantic.danger.bg, borderColor: colors.semantic.danger.border }]}>
          <AlertTriangle size={16} color={colors.semantic.danger.text} />
          <ThemedText style={{ color: colors.semantic.danger.text, flex: 1 }}>{error}</ThemedText>
        </View>
      )}

      {!loading && !error && !selectedTeacherId && todaySummary && !todaySummary.nonWorkingDay && (
        <>
          <SummaryTileRow>
            <SummaryTile label="Present today" value={todaySummary.present} tone="positive" />
            <SummaryTile label="Late today" value={todaySummary.late} />
          </SummaryTileRow>
          <SummaryTileRow>
            <SummaryTile label="Missing checkout" value={todaySummary.missingCheckout} />
            <SummaryTile label="Absent, no leave" value={todaySummary.absent} tone="negative" />
          </SummaryTileRow>
        </>
      )}

      {!loading && !error && !selectedTeacherId && todaySummary?.nonWorkingDay && (
        <ThemedText variant="muted" style={styles.hint}>{todaySummary.nonWorkingDay.message}</ThemedText>
      )}

      {!loading && !error && selectedTeacherId && (
        <View style={styles.detail}>
          <Button title="Back to all teachers" variant="text" onPress={backToAllTeachers} style={styles.backBtn} />
          {detailLoading && <View style={styles.center}><ActivityIndicator color={colors.orange} /></View>}
          {!detailLoading && !!detailError && (
            <ThemedText style={{ color: colors.semantic.danger.text }}>{detailError}</ThemedText>
          )}
          {!detailLoading && !detailError && detailTeacher && detailSummary && (
            <>
              <View style={styles.detailHeader}>
                <View style={[styles.avatarLg, { backgroundColor: colors.orangeSoft }]}>
                  <ThemedText style={[styles.avatarLgText, { color: colors.orangeDark }]}>{initials(detailTeacher.name)}</ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.detailName}>{detailTeacher.name}</ThemedText>
                  <ThemedText variant="muted" style={styles.detailEmail}>{detailTeacher.email}</ThemedText>
                </View>
              </View>

              {!trendLoading && trend.length > 0 && (
                <Card style={styles.panel}>
                  <ThemedText style={styles.panelTitle}>Late &amp; missing-checkout trend</ThemedText>
                  <View style={styles.trendStrip}>
                    {trend.map((t) => (
                      <View key={t.month} style={styles.trendBarWrap}>
                        <View
                          style={[
                            styles.trendBar,
                            {
                              height: `${Math.max(6, (t.count / trendMax) * 100)}%`,
                              backgroundColor: t.count === 0 ? colors.border : t.count / trendMax >= 0.66 ? colors.semantic.danger.action : colors.semantic.warning.text,
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                  <View style={styles.trendLabels}>
                    {trend.map((t) => (
                      <ThemedText key={t.month} variant="muted" style={styles.trendLabel}>{monthShortLabel(t.month)}</ThemedText>
                    ))}
                  </View>
                </Card>
              )}

              <Card style={styles.panel}>
                <ThemedText style={styles.panelTitle}>This month</ThemedText>
                <AttendanceCalendarStrip rows={detailRows} />
                <ThemedText variant="muted" style={styles.summaryText}>{formatSummary(detailSummary)}</ThemedText>
              </Card>

              <ThemedText style={styles.panelTitle}>Day by day</ThemedText>
              <View style={[styles.dayList, { borderColor: colors.border }]}>
                {detailRows.map((row) => {
                  const detailRecord = row.record ? detailRecords.find((r) => r.date === row.date) : undefined;
                  if (correctingDate === row.date && detailRecord) {
                    return (
                      <AttendanceCorrectionForm
                        key={row.date}
                        entry={detailRecord}
                        onResolved={handleCorrected}
                        onCancel={() => setCorrectingDate(null)}
                      />
                    );
                  }
                  return (
                    <AttendanceHistoryRow
                      key={row.date}
                      row={row}
                      action={
                        row.record ? (
                          <Pressable
                            onPress={() => setCorrectingDate(row.date)}
                            style={styles.correctBtn}
                            accessibilityRole="button"
                            accessibilityLabel={`Correct ${row.date}`}
                          >
                            <Pencil size={12} color={colors.orange} />
                            <ThemedText style={{ color: colors.orange, fontSize: 12, fontWeight: '600' }}>Correct</ThemedText>
                          </Pressable>
                        ) : undefined
                      }
                    />
                  );
                })}
              </View>
            </>
          )}
        </View>
      )}

      {!loading && !error && !selectedTeacherId && (
        <>
          <View style={[styles.searchBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Search size={16} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by teacher name"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Search by teacher name"
            />
          </View>

          <View style={styles.toolbarRow}>
            <Pressable
              onPress={() => setOnlyFlagged((v) => !v)}
              style={[styles.filterChip, { backgroundColor: onlyFlagged ? colors.orangeSoft : colors.surface2, borderColor: onlyFlagged ? colors.orange : colors.border }]}
              accessibilityRole="button"
              accessibilityState={{ selected: onlyFlagged }}
            >
              <ThemedText style={{ fontSize: 12, fontWeight: '600' }}>
                Needs a look{needsLookCount > 0 ? ` (${needsLookCount})` : ''}
              </ThemedText>
            </Pressable>
            <Pressable onPress={handleDownload} disabled={downloading} style={styles.downloadBtn} accessibilityRole="button">
              <Download size={15} color={colors.text} />
              <ThemedText style={{ fontSize: 13 }}>{downloading ? 'Downloading…' : 'Download Excel'}</ThemedText>
            </Pressable>
          </View>

          {!!downloadError && <ThemedText style={{ color: colors.semantic.danger.text }}>{downloadError}</ThemedText>}

          {sorted.length === 0 && (
            <ThemedText variant="muted" style={styles.hint}>
              {search.trim() ? `No teachers match "${search.trim()}".` : onlyFlagged ? 'No teachers need a look right now.' : 'No teachers found.'}
            </ThemedText>
          )}

          {sorted.length > 0 && (
            <AttendanceReportsTable
              teachers={sorted}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              patternThreshold={patternThreshold}
              onSelectTeacher={openTeacher}
            />
          )}

          {sorted.length > 0 && (
            <View style={styles.paginationRow}>
              <ThemedText variant="muted" style={styles.paginationLabel}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} teachers
              </ThemedText>
              <View style={styles.paginationBtns}>
                <Pressable onPress={() => setPage((p) => p - 1)} disabled={page <= 1} accessibilityRole="button">
                  <ThemedText style={[styles.paginationBtnText, { color: colors.orange }, page <= 1 && styles.paginationBtnDisabled]}>
                    Previous
                  </ThemedText>
                </Pressable>
                <ThemedText variant="muted" style={styles.paginationBtnText}>Page {page} of {totalPages}</ThemedText>
                <Pressable onPress={() => setPage((p) => p + 1)} disabled={page >= totalPages} accessibilityRole="button">
                  <ThemedText style={[styles.paginationBtnText, { color: colors.orange }, page >= totalPages && styles.paginationBtnDisabled]}>
                    Next
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navLabel: { fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', paddingVertical: spacing.xl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  hint: { fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: spacing.md, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  filterChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  paginationRow: { gap: spacing.xs, paddingTop: spacing.xs },
  paginationLabel: { fontSize: 12 },
  paginationBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  paginationBtnText: { fontSize: 13, fontWeight: '600' },
  paginationBtnDisabled: { opacity: 0.4 },
  detail: { gap: spacing.sm },
  backBtn: { alignSelf: 'flex-start' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarLg: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarLgText: { fontWeight: '700', fontSize: 18 },
  detailName: { fontSize: 17, fontWeight: '700' },
  detailEmail: { fontSize: 13 },
  panel: { gap: spacing.xs },
  panelTitle: { fontSize: 14, fontWeight: '700' },
  trendStrip: { flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: spacing.xs },
  trendBarWrap: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  trendBar: { borderRadius: 4, minHeight: 4 },
  trendLabels: { flexDirection: 'row', gap: spacing.xs },
  trendLabel: { flex: 1, fontSize: 10, textAlign: 'center' },
  summaryText: { fontSize: 13, textAlign: 'center' },
  dayList: { marginTop: spacing.xs },
  correctBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
