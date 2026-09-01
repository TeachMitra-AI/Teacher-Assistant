// The drill-down list a tapped filter tile opens (ReportsScreen.tsx) —
// ported from client/src/components/classroom/ReportsPanel.tsx's
// FeeStatusModal (a centered dialog on web; a bottom sheet here, matching
// this app's own SelectField.tsx convention for "a list in a modal").
import React from 'react';
import { View, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, FileBarChart } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { useTheme } from '../../../theme/ThemeContext';
import { radius, spacing } from '../../../theme/tokens';
import { formatMonthLabel } from '../../../lib/classroomDate';
import { feeBadgeText } from '../../../lib/feeBadge';
import type { StudentFeeStatus } from '../../../types';

interface FeeStatusModalProps {
  visible: boolean;
  title: string;
  period: string;
  students: StudentFeeStatus[];
  onClose: () => void;
}

export function FeeStatusModal({ visible, title, period, students, onClose }: FeeStatusModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md }]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.head}>
            <ThemedText style={styles.title} numberOfLines={2}>{title} — {formatMonthLabel(period)}</ThemedText>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" testID="fee-status-modal-close">
              <X size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {students.length === 0 ? (
            <View style={styles.empty} testID="fee-status-modal-empty">
              <FileBarChart size={22} color={colors.textMuted} strokeWidth={1.8} />
              <ThemedText variant="title" style={styles.emptyTitle}>No students in this category</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>No students match for {formatMonthLabel(period)}.</ThemedText>
            </View>
          ) : (
            <FlatList
              data={students}
              keyExtractor={(s) => s.studentId}
              style={styles.list}
              testID="fee-status-modal-list"
              renderItem={({ item }) => (
                <View style={[styles.row, { borderColor: colors.border }]}>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.name}>{item.name}</ThemedText>
                    {item.rollNumber && <ThemedText variant="muted" style={styles.roll}>Roll {item.rollNumber}</ThemedText>}
                  </View>
                  <ThemedText variant="muted" style={styles.badge}>{feeBadgeText(item)}</ThemedText>
                </View>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '75%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.sm },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  roll: { fontSize: 12 },
  badge: { fontSize: 13, fontWeight: '600', textAlign: 'right' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.lg },
});
