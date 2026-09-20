// Native port of client/src/components/attendance/ActivityLogTab.tsx —
// school_admin only. A reverse-chronological, grouped-by-day timeline of
// every check-in/check-out/blocked-attempt/correction, with a summary strip,
// search, a category segmented control, and a day-range chip picker.
// Secondary, investigative — not the landing screen (that's Reports).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator, StyleSheet, type ViewStyle } from 'react-native';
import {
  AlertTriangle, Search, LogIn, LogOut, Ban, Pencil, Palmtree, Briefcase, CalendarDays,
  Settings as SettingsIcon, Bell, type LucideIcon,
} from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import { getActivityLog } from '../../api/teacherAttendanceApi';
import type { TeacherAttendanceActivityLogEntry } from '../../types';

const PAGE_SIZE = 25;
const DAY_OPTIONS = [7, 30, 90];

type Tone = 'routine' | 'warning' | 'admin';
type Category = 'all' | 'teacher' | 'admin';

const ACTION_META: Record<string, { label: string; icon: LucideIcon; tone: Tone }> = {
  login: { label: 'Logged in', icon: LogIn, tone: 'routine' },
  check_in: { label: 'Checked in', icon: LogIn, tone: 'routine' },
  check_out: { label: 'Checked out', icon: LogOut, tone: 'routine' },
  check_in_blocked: { label: 'Check-in blocked', icon: Ban, tone: 'warning' },
  check_out_blocked: { label: 'Checkout blocked', icon: Ban, tone: 'warning' },
  reminder_sent: { label: 'Checkout reminder sent', icon: Bell, tone: 'routine' },
  correction: { label: 'Correction', icon: Pencil, tone: 'admin' },
  mark_on_leave: { label: 'Marked on leave', icon: Palmtree, tone: 'admin' },
  mark_on_duty: { label: 'Marked on duty', icon: Briefcase, tone: 'admin' },
  holiday_changed: { label: 'Holiday changed', icon: CalendarDays, tone: 'admin' },
  settings_changed: { label: 'Settings changed', icon: SettingsIcon, tone: 'admin' },
};

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'teacher', label: 'Teacher activity' },
  { value: 'admin', label: 'Admin actions' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateGroupKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ActivityLogScreen() {
  const { colors } = useTheme();
  const [days, setDays] = useState(7);
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<TeacherAttendanceActivityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [summary, setSummary] = useState<{ total: number; teacher: number; admin: number; blocked: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [all, teacher, admin, blockedIn, blockedOut] = await Promise.all([
          getActivityLog({ days, pageSize: 1 }),
          getActivityLog({ days, category: 'teacher', pageSize: 1 }),
          getActivityLog({ days, category: 'admin', pageSize: 1 }),
          getActivityLog({ days, action: 'check_in_blocked', pageSize: 1 }),
          getActivityLog({ days, action: 'check_out_blocked', pageSize: 1 }),
        ]);
        if (!cancelled) {
          setSummary({ total: all.total, teacher: teacher.total, admin: admin.total, blocked: blockedIn.total + blockedOut.total });
        }
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getActivityLog({
        days, page, pageSize: PAGE_SIZE,
        category: category === 'all' ? undefined : category,
        search: search.trim() || undefined,
      });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the activity log.');
    } finally {
      setLoading(false);
    }
  }, [days, page, category, search]);

  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [days, category, search]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: TeacherAttendanceActivityLogEntry[] }>();
    for (const e of entries) {
      const key = dateGroupKey(e.createdAt);
      if (!map.has(key)) map.set(key, { label: dateGroupLabel(e.createdAt), items: [] });
      map.get(key)!.items.push(e);
    }
    return Array.from(map.values());
  }, [entries]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const toneColor = (tone: Tone) =>
    tone === 'warning' ? colors.semantic.warning.text : tone === 'admin' ? colors.orange : colors.semantic.success.text;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <ThemedText variant="muted" style={styles.hint}>
        Every check-in, check-out, blocked attempt, and correction, for later lookup — not something you need to review daily.
      </ThemedText>

      {summary && summary.total > 0 && (
        <View style={styles.summaryStrip}>
          <ThemedText variant="muted" style={styles.summaryItem}>
            <ThemedText style={styles.summaryItemStrong}>{summary.total}</ThemedText> events
          </ThemedText>
          <ThemedText variant="muted" style={styles.summaryItem}>
            <ThemedText style={[styles.summaryItemStrong, { color: colors.semantic.success.text }]}>{summary.teacher}</ThemedText> teacher activity
          </ThemedText>
          <ThemedText variant="muted" style={styles.summaryItem}>
            <ThemedText style={styles.summaryItemStrong}>{summary.admin}</ThemedText> admin actions
          </ThemedText>
          {summary.blocked > 0 && (
            <ThemedText variant="muted" style={styles.summaryItem}>
              <ThemedText style={[styles.summaryItemStrong, { color: colors.semantic.warning.text }]}>{summary.blocked}</ThemedText> blocked attempts
            </ThemedText>
          )}
        </View>
      )}

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

      <View style={[styles.segmented, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        {CATEGORY_OPTIONS.map((c) => {
          const active = category === c.value;
          return (
            <Pressable
              key={c.value}
              onPress={() => setCategory(c.value)}
              style={[styles.segment, active && { backgroundColor: colors.surface }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <ThemedText style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{c.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chipRow}>
        {DAY_OPTIONS.map((d) => {
          const active = days === d;
          return (
            <Pressable
              key={d}
              onPress={() => setDays(d)}
              style={[styles.dayChip, { backgroundColor: active ? colors.orangeSoft : colors.surface2, borderColor: active ? colors.orange : colors.border }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <ThemedText style={{ fontSize: 12, fontWeight: '600' }}>{d}d</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {loading && <View style={styles.center}><ActivityIndicator color={colors.orange} /></View>}

      {!loading && !!error && (
        <View style={[styles.banner, { backgroundColor: colors.semantic.danger.bg, borderColor: colors.semantic.danger.border }]}>
          <AlertTriangle size={16} color={colors.semantic.danger.text} />
          <ThemedText style={{ color: colors.semantic.danger.text, flex: 1 }}>{error}</ThemedText>
        </View>
      )}

      {!loading && !error && entries.length === 0 && (
        <ThemedText variant="muted" style={styles.hint}>
          {search.trim() ? `No activity for "${search.trim()}" in this window.` : 'No activity in this window.'}
        </ThemedText>
      )}

      {!loading && !error && groups.map((group) => (
        <View key={group.label + group.items[0].id} style={styles.dayGroup}>
          <ThemedText variant="muted" style={styles.dayGroupLabel}>{group.label}</ThemedText>
          {group.items.map((e) => {
            const meta = ACTION_META[e.action] ?? { label: e.action, icon: Bell, tone: 'routine' as Tone };
            const Icon = meta.icon;
            const dotStyle: ViewStyle = { backgroundColor: colors.surface2, borderColor: colors.border };
            return (
              <View key={e.id} style={styles.event}>
                <View style={[styles.dot, dotStyle]}>
                  <Icon size={14} color={toneColor(meta.tone)} />
                </View>
                <View style={styles.eventContent}>
                  <ThemedText style={styles.eventPrimary}>
                    <ThemedText style={styles.eventBold}>{e.userName ?? 'Unknown'}</ThemedText> {meta.label}
                  </ThemedText>
                  {!!e.result && <ThemedText variant="muted" style={styles.eventSecondary}>{e.result}</ThemedText>}
                </View>
                <ThemedText variant="muted" style={styles.eventTime}>{formatTime(e.createdAt)}</ThemedText>
              </View>
            );
          })}
        </View>
      ))}

      {!loading && !error && groups.length > 0 && (
        <View style={styles.paginationRow}>
          <ThemedText variant="muted" style={styles.paginationLabel}>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  hint: { fontSize: 12, textAlign: 'center' },
  summaryStrip: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 2 },
  summaryItem: { fontSize: 13 },
  summaryItemStrong: { fontSize: 13, fontWeight: '700' },
  paginationRow: { gap: spacing.xs, paddingTop: spacing.xs },
  paginationLabel: { fontSize: 12 },
  paginationBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  paginationBtnText: { fontSize: 13, fontWeight: '600' },
  paginationBtnDisabled: { opacity: 0.4 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: spacing.md, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  segmented: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: 3, gap: 2 },
  segment: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm - 2, alignItems: 'center' },
  segmentLabel: { fontSize: 12, fontWeight: '600' },
  segmentLabelActive: { fontWeight: '700' },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  dayChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  center: { alignItems: 'center', paddingVertical: spacing.xl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  dayGroup: { gap: spacing.xs },
  dayGroupLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  event: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  eventContent: { flex: 1, gap: 1 },
  eventPrimary: { fontSize: 13 },
  eventBold: { fontWeight: '700' },
  eventSecondary: { fontSize: 12 },
  eventTime: { fontSize: 11 },
});
