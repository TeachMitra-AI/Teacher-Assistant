// Fee status board (§14) — native re-expression of client/src/components/
// classroom/FeeStatusBoard.tsx. A month navigator, a summary strip (Total/
// Paid/Partial/Pending), and one row per student with a draft amount-paid
// input and a save button gated on that draft actually differing from the
// last-saved amount. `status` is a read-only badge — always derived
// server-side, never a control the teacher taps directly.
import React from 'react';
import { View, FlatList, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, Check, Wallet } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { useTheme } from '../../../theme/ThemeContext';
import type { ThemeColors } from '../../../theme/tokens';
import { spacing, radius } from '../../../theme/tokens';
import { formatMonthLabel } from '../../../lib/classroomDate';
import { useFeeStatusScreen } from './useFeeStatusScreen';
import type { StudentFeeStatus, FeeStatus } from '../../../types';

function statusLabel(status: FeeStatus): string {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  return 'Pending';
}

function statusColor(status: FeeStatus, colors: ThemeColors): string {
  if (status === 'paid') return colors.semantic.success.text;
  if (status === 'partial') return colors.semantic.warning.text;
  return colors.semantic.danger.text;
}

export function FeeStatusScreen({ classId }: { classId: string }) {
  const { colors } = useTheme();
  const {
    period,
    board,
    loading,
    error,
    savingId,
    saveError,
    drafts,
    goToPreviousMonth,
    goToNextMonth,
    setDraft,
    save,
    reload,
  } = useFeeStatusScreen(classId);

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
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.centerText}>Loading fee status…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && board && (
        <>
          <ThemedText variant="muted" style={styles.hint}>
            {board.feeAmount != null
              ? `Monthly fee: ₹${board.feeAmount} per student. Set on the Classes screen.`
              : 'No monthly fee amount set for this class yet — set one on the Classes screen to track pending amounts.'}
          </ThemedText>

          <SummaryTileRow>
            <SummaryTile label="Total Students" value={board.totalStudents} />
            <SummaryTile label="Paid" value={board.paid} tone="positive" />
            <SummaryTile label="Partial" value={board.partial} />
            <SummaryTile label="Pending" value={board.pending} tone="negative" />
          </SummaryTileRow>

          <ThemedText variant="muted" style={styles.collectedLine}>
            ₹{board.totalCollected} collected{board.totalExpected > 0 ? ` of ₹${board.totalExpected} expected` : ''} this month.
          </ThemedText>

          {!!saveError && <ThemedText style={{ color: colors.semantic.danger.text }}>{saveError}</ThemedText>}

          {board.perStudent.length === 0 && (
            <View style={styles.center} testID="fees-empty-state">
              <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
                <Wallet size={26} color={colors.textMuted} strokeWidth={1.8} />
              </View>
              <ThemedText variant="title" style={styles.emptyTitle}>No active students</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>Add students to this class first, from the Students screen.</ThemedText>
            </View>
          )}

          {board.perStudent.length > 0 && (
            <FlatList
              data={board.perStudent}
              keyExtractor={(s) => s.studentId}
              contentContainerStyle={styles.list}
              testID="fees-student-list"
              renderItem={({ item }: { item: StudentFeeStatus }) => {
                const draft = drafts[item.studentId] ?? '';
                const draftAmount = draft.trim() === '' ? 0 : Number(draft);
                const dirty = draftAmount !== (item.amount || 0);
                const saving = savingId === item.studentId;
                const canSave = dirty && Number.isInteger(draftAmount) && draftAmount >= 0 && !saving;
                return (
                  <View style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                    <View style={styles.rowText}>
                      <ThemedText style={styles.name}>{item.name}</ThemedText>
                      {item.rollNumber && <ThemedText variant="muted" style={styles.roll}>Roll {item.rollNumber}</ThemedText>}
                    </View>
                    <View style={styles.rowActions}>
                      <ThemedText
                        style={[styles.statusBadge, { color: statusColor(item.status, colors) }]}
                        testID={`fee-status-${item.studentId}`}
                      >
                        {statusLabel(item.status)}
                        {item.expectedAmount != null ? ` (₹${item.expectedAmount})` : ''}
                      </ThemedText>
                      <TextInput
                        style={[styles.amountInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                        value={draft}
                        onChangeText={(t) => setDraft(item.studentId, t)}
                        keyboardType="number-pad"
                        editable={!saving}
                        accessibilityLabel={`Amount paid by ${item.name}`}
                        testID={`fee-amount-input-${item.studentId}`}
                      />
                      <Pressable
                        onPress={() => { void save(item.studentId); }}
                        disabled={!canSave}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Save amount paid for ${item.name}`}
                        accessibilityState={{ disabled: !canSave }}
                        testID={`fee-save-${item.studentId}`}
                        style={[
                          styles.saveBtn,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                          !canSave && styles.saveBtnDisabled,
                        ]}
                      >
                        {saving ? <ActivityIndicator size="small" color={colors.orange} /> : <Check size={15} color={colors.text} />}
                      </Pressable>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </>
      )}
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
  monthLabel: { fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  centerText: { marginTop: spacing.xs },
  hint: { fontSize: 13 },
  collectedLine: { fontSize: 13 },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, minHeight: 64,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  roll: { fontSize: 12 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusBadge: { fontSize: 12, fontWeight: '600', minWidth: 72, textAlign: 'right' },
  amountInput: {
    width: 72, minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, fontSize: 14, textAlign: 'right',
  },
  saveBtn: {
    width: 40, height: 40, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
});
