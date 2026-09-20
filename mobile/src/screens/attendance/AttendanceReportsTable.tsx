// Native port of ReportsTab.tsx's actual table markup (client/src/index.css's
// .attendance-reports-table rules) — verified directly against the web app's
// own mobile viewport (390px), which keeps a real horizontally-scrollable
// table rather than switching to stacked cards. The "Teacher" column stays
// fixed on the left (CSS `position: sticky; left: 0`) while the rest of the
// row scrolls horizontally — replicated here as two independent views: a
// fixed-width column of name cells on the left, and one horizontal
// ScrollView on the right holding the numeric columns, with identical
// per-row heights on both sides so they stay visually aligned.
import React from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { ChevronUp, ChevronDown, ArrowUpDown, ChevronRight } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import type { SchoolHistoryTeacherSummary, TeacherAttendanceSummary } from '../../types';

export type SortKey = 'name' | keyof TeacherAttendanceSummary;

const NAME_COL_WIDTH = 168;
const NUM_COL_WIDTH = 84;
const CHEVRON_COL_WIDTH = 28;
const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 40;

const COLUMNS: { key: SortKey; label: string; dividerBefore?: boolean }[] = [
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'late', label: 'Late' },
  { key: 'half_day', label: 'Half day' },
  { key: 'on_leave', label: 'On leave' },
  { key: 'on_duty', label: 'On duty' },
  { key: 'flagged_review', label: 'Needs review', dividerBefore: true },
  { key: 'pending_regularization', label: 'Missing checkout' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function AttendanceReportsTable({
  teachers,
  sortKey,
  sortDir,
  onSort,
  patternThreshold,
  onSelectTeacher,
}: {
  teachers: SchoolHistoryTeacherSummary[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  patternThreshold: number;
  onSelectTeacher: (id: string) => void;
}) {
  const { colors } = useTheme();

  function sortIcon(active: boolean) {
    if (!active) return <ArrowUpDown size={11} color={colors.textMuted} style={{ opacity: 0.5 }} />;
    return sortDir === 'asc' ? <ChevronUp size={12} color={colors.orange} /> : <ChevronDown size={12} color={colors.orange} />;
  }

  return (
    <View style={[styles.wrap, { borderColor: colors.border }]}>
      <View style={styles.body}>
        {/* Fixed "Teacher" column */}
        <View style={[styles.nameCol, { backgroundColor: colors.surface2 }]}>
          <Pressable onPress={() => onSort('name')} style={[styles.nameHeaderCell, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.headerLabel, sortKey === 'name' && { color: colors.orange }]}>TEACHER</ThemedText>
            {sortIcon(sortKey === 'name')}
          </Pressable>
          {teachers.map((t, i) => (
            <Pressable
              key={t.id}
              onPress={() => onSelectTeacher(t.id)}
              style={[
                styles.nameCell,
                { backgroundColor: i % 2 === 1 ? colors.surface2 : colors.surface, borderBottomColor: colors.border },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.orangeSoft }]}>
                <ThemedText style={[styles.avatarText, { color: colors.orangeDark }]}>{initials(t.name)}</ThemedText>
              </View>
              <View style={styles.nameTextWrap}>
                <ThemedText style={styles.nameText} numberOfLines={1}>{t.name}</ThemedText>
                <ThemedText variant="muted" style={styles.emailText} numberOfLines={1}>{t.email}</ThemedText>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Horizontally scrolling numeric columns + trailing chevron */}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={[styles.numHeaderRow, { backgroundColor: colors.surface2, borderBottomColor: colors.border }]}>
              {COLUMNS.map((col) => (
                <Pressable
                  key={col.key}
                  onPress={() => onSort(col.key)}
                  style={[styles.numHeaderCell, col.dividerBefore && { borderLeftWidth: 2, borderLeftColor: colors.border }]}
                >
                  {sortIcon(sortKey === col.key)}
                  <ThemedText style={[styles.headerLabel, sortKey === col.key && { color: colors.orange }]} numberOfLines={1}>
                    {col.label.toUpperCase()}
                  </ThemedText>
                </Pressable>
              ))}
              <View style={styles.chevronHeaderCell} />
            </View>
            {teachers.map((t, i) => (
              <Pressable
                key={t.id}
                onPress={() => onSelectTeacher(t.id)}
                style={[styles.numRow, { backgroundColor: i % 2 === 1 ? colors.surface2 : colors.surface, borderBottomColor: colors.border }]}
              >
                {COLUMNS.map((col) => {
                  const value = t.summary[col.key as keyof TeacherAttendanceSummary];
                  const isBadgeCol = col.key === 'flagged_review' || col.key === 'pending_regularization';
                  const warn = isBadgeCol && value >= patternThreshold && value > 0;
                  return (
                    <View
                      key={col.key}
                      style={[styles.numCell, col.dividerBefore && { borderLeftWidth: 2, borderLeftColor: colors.border }]}
                    >
                      {isBadgeCol && value > 0 ? (
                        <View style={[styles.badge, { backgroundColor: warn ? colors.semantic.warning.bg : colors.orangeSoft }]}>
                          <ThemedText style={[styles.badgeText, { color: warn ? colors.semantic.warning.text : colors.orangeDark }]}>
                            {value}
                          </ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={[styles.numValue, value === 0 && { color: colors.textMuted, opacity: 0.6 }]}>
                          {value}
                        </ThemedText>
                      )}
                    </View>
                  );
                })}
                <View style={styles.chevronCell}>
                  <ChevronRight size={15} color={colors.textMuted} />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  body: { flexDirection: 'row' },
  nameCol: { width: NAME_COL_WIDTH },
  nameHeaderCell: {
    height: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, borderBottomWidth: 2,
  },
  nameCell: {
    height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 10, fontWeight: '700' },
  nameTextWrap: { flex: 1, minWidth: 0 },
  nameText: { fontSize: 13, fontWeight: '600' },
  emailText: { fontSize: 10.5 },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  numHeaderRow: { flexDirection: 'row', height: HEADER_HEIGHT, borderBottomWidth: 2 },
  numHeaderCell: {
    width: NUM_COL_WIDTH, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    paddingHorizontal: spacing.sm,
  },
  chevronHeaderCell: { width: CHEVRON_COL_WIDTH },
  numRow: { flexDirection: 'row', height: ROW_HEIGHT, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  numCell: { width: NUM_COL_WIDTH, alignItems: 'flex-end', paddingHorizontal: spacing.sm },
  numValue: { fontSize: 14, fontWeight: '600' },
  badge: { minWidth: 24, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignItems: 'center' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  chevronCell: { width: CHEVRON_COL_WIDTH, alignItems: 'center', justifyContent: 'center' },
});
