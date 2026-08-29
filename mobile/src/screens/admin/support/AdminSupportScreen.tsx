// Support tab (Admin > Support, super_admin only — gated one level up in
// AdminScreen.tsx). Native port of AdminSupportPage.tsx: a KPI strip, then a
// searchable/filterable/paginated ticket list that pushes
// AdminSupportTicketScreen on tap.
//
// From/To are plain YYYY-MM-DD text fields rather than a native date picker
// — this app has no date-picker dependency yet (Attendance/Reports use a
// calendar-free month string picker instead), and adding one for this one
// secondary filter isn't warranted, the same "no new dependency for a small
// need" call as DailyTrendChart.tsx's dependency-free chart.
import React from 'react';
import { View, FlatList, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../../../navigation/types';
import { ThemedText } from '../../../components/ThemedText';
import { Card } from '../../../components/Card';
import { SelectField } from '../../../components/SelectField';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { Pager } from '../../../components/Pager';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { BUG_CATEGORIES, FEEDBACK_CATEGORIES } from '../../../config';
import { useAdminSupportScreen } from './useAdminSupportScreen';
import type { SupportTicketStatus, SupportTicketSummary, SupportTicketType } from '../../../types';

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open', triaged: 'Triaged', resolved: 'Resolved', wont_fix: "Won't fix",
};
const STATUSES = Object.keys(STATUS_LABELS) as SupportTicketStatus[];
const TYPE_LABELS: Record<SupportTicketType, string> = { bug: 'Bug', feedback: 'Feedback' };
const TYPES = Object.keys(TYPE_LABELS) as SupportTicketType[];

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type Props = { navigation: NativeStackScreenProps<AppStackParamList, 'Admin'>['navigation'] };

export function AdminSupportScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const s = useAdminSupportScreen();
  const categoryOptions = s.typeFilter === 'bug' ? BUG_CATEGORIES : s.typeFilter === 'feedback' ? FEEDBACK_CATEGORIES : [];

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <>
          {s.stats && (
            <SummaryTileRow>
              <SummaryTile label="Open" value={s.stats.open} />
              <SummaryTile label="Today" value={s.stats.today} />
              <SummaryTile label="Bugs : Feedback" value={`${s.stats.bugs} : ${s.stats.feedback}`} />
            </SummaryTileRow>
          )}

          <View style={[styles.searchBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Search size={16} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={s.tickets.search}
              onChangeText={s.tickets.setSearch}
              placeholder="Search description, reporter, or reference"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Search support tickets"
            />
          </View>

          <View style={styles.filters}>
            <View style={styles.filterField}>
              <SelectField
                label="Status"
                options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((st) => ({ value: st, label: STATUS_LABELS[st] }))]}
                value={s.statusFilter}
                onChange={(v) => s.setStatusFilter(v as SupportTicketStatus | '')}
              />
            </View>
            <View style={styles.filterField}>
              <SelectField
                label="Type"
                options={[{ value: '', label: 'All types' }, ...TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))]}
                value={s.typeFilter}
                onChange={(v) => s.handleTypeChange(v as SupportTicketType | '')}
              />
            </View>
          </View>
          <View style={styles.filters}>
            <View style={styles.filterField}>
              <SelectField
                label="Category"
                options={[{ value: '', label: s.typeFilter ? 'All categories' : 'Choose a type first' }, ...categoryOptions]}
                value={s.categoryFilter}
                onChange={s.setCategoryFilter}
              />
            </View>
            <View style={styles.filterField}>
              <SelectField
                label="School"
                options={[{ value: '', label: 'All schools' }, ...s.schools.map((sc) => ({ value: sc.id, label: sc.name }))]}
                value={s.schoolFilter}
                onChange={s.setSchoolFilter}
              />
            </View>
          </View>
          <View style={styles.filters}>
            <TextInput
              style={[styles.dateInput, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
              value={s.fromFilter}
              onChangeText={s.setFromFilter}
              placeholder="From (YYYY-MM-DD)"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="From date"
            />
            <TextInput
              style={[styles.dateInput, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
              value={s.toFilter}
              onChangeText={s.setToFilter}
              placeholder="To (YYYY-MM-DD)"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="To date"
            />
          </View>

          {s.tickets.loading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.orange} />
            </View>
          )}
          {!s.tickets.loading && !!s.tickets.error && (
            <ThemedText style={{ color: colors.semantic.danger.text }}>{s.tickets.error}</ThemedText>
          )}
          {!s.tickets.loading && !s.tickets.error && s.tickets.items.length === 0 && (
            <ThemedText variant="muted" style={styles.empty}>
              {s.tickets.isFiltering ? 'No tickets match your search or filters.' : 'No tickets yet.'}
            </ThemedText>
          )}
        </>
      }
      data={s.tickets.loading || s.tickets.error ? [] : s.tickets.items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }: { item: SupportTicketSummary }) => (
        <Pressable
          onPress={() => navigation.navigate('AdminSupportTicket', { id: item.id })}
          accessibilityRole="button"
          testID={`support-ticket-${item.id}`}
        >
          <Card style={styles.row}>
            <View style={styles.rowHead}>
              <View style={[styles.typeTag, { backgroundColor: colors.surface2 }]}>
                <ThemedText style={styles.typeTagText}>{TYPE_LABELS[item.type]}</ThemedText>
              </View>
              <ThemedText variant="muted" style={styles.ref}>#{item.id.slice(-8)}</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                <ThemedText variant="muted" style={styles.statusText}>{STATUS_LABELS[item.status]}</ThemedText>
              </View>
            </View>
            <ThemedText numberOfLines={2} style={styles.summary}>{item.description || '—'}</ThemedText>
            <ThemedText variant="muted" style={styles.rowMeta}>
              {item.school?.name || '—'} · {item.user?.name || '—'} · {relativeTime(item.createdAt)}
            </ThemedText>
          </Card>
        </Pressable>
      )}
      ListFooterComponent={
        !s.tickets.loading && !s.tickets.error && s.tickets.items.length > 0 ? (
          <Pager
            noun={{ one: 'ticket', many: 'tickets' }}
            page={s.tickets.page}
            totalPages={s.tickets.totalPages}
            total={s.tickets.total}
            rangeStart={s.tickets.rangeStart}
            rangeEnd={s.tickets.rangeEnd}
            hasPrev={s.tickets.hasPrev}
            hasNext={s.tickets.hasNext}
            onPageChange={s.tickets.setPage}
            busy={s.tickets.loading}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, marginTop: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  filters: { flexDirection: 'row', gap: spacing.sm },
  filterField: { flex: 1 },
  dateInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 14 },
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  row: { gap: 4, marginBottom: spacing.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  typeTag: { borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  typeTagText: { fontSize: 11, fontWeight: '700' },
  ref: { fontSize: 11, flex: 1 },
  statusPill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '600' },
  summary: { fontSize: 14 },
  rowMeta: { fontSize: 12 },
});
