// Native analogue of client/src/components/TablePager.tsx — a "showing X–Y
// of N" label plus Prev/Next controls, for the four server-paginated admin
// lists (Manage's Schools/Pending/Users, Support's ticket list) that all use
// lib/usePagedList.ts.
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme/tokens';

interface PagerProps {
  page: number;
  totalPages: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPageChange: (page: number) => void;
  busy: boolean;
  noun: { one: string; many: string };
}

export function Pager({ page, totalPages, total, rangeStart, rangeEnd, hasPrev, hasNext, onPageChange, busy, noun }: PagerProps) {
  const { colors } = useTheme();
  const label = total === 0
    ? `No ${noun.many}`
    : `${rangeStart}–${rangeEnd} of ${total} ${total === 1 ? noun.one : noun.many}`;

  return (
    <View style={styles.row}>
      <ThemedText variant="muted" style={styles.label}>{label}</ThemedText>
      <View style={styles.buttons}>
        <Pressable
          onPress={() => onPageChange(page - 1)}
          disabled={!hasPrev || busy}
          style={[styles.btn, { borderColor: colors.border }, (!hasPrev || busy) && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Previous page"
        >
          <ChevronLeft size={16} color={colors.text} />
        </Pressable>
        <ThemedText variant="muted" style={styles.pageLabel}>{page} / {totalPages}</ThemedText>
        <Pressable
          onPress={() => onPageChange(page + 1)}
          disabled={!hasNext || busy}
          style={[styles.btn, { borderColor: colors.border }, (!hasNext || busy) && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Next page"
        >
          <ChevronRight size={16} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm },
  label: { fontSize: 12, flex: 1 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: {
    width: 32, height: 32, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  pageLabel: { fontSize: 12, minWidth: 40, textAlign: 'center' },
});
