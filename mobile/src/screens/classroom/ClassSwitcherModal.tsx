// Class Home's class-switcher (Phase 8 Step 4, §12) — a genuine bottom
// sheet (not the centered-dialog Modal pattern StudentFormModal/
// ClassFormModal use for forms), matching UI_REFINED.md §12.3's own
// sheet spec: surface + top-rounded corners + drag handle + safe-area
// bottom padding. Read-only selection list — no create/archive/restore
// here, those live on Class List (the fuller class-management surface);
// this sheet's only job is picking which already-active class Class Home
// is scoped to.
import React from 'react';
import { View, Pressable, Modal, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import type { SchoolClass } from '../../types';

interface ClassSwitcherModalProps {
  visible: boolean;
  classes: SchoolClass[];
  loading: boolean;
  error: string;
  currentClassId: string;
  onSelect: (cls: SchoolClass) => void;
  onRetry: () => void;
  onClose: () => void;
}

export function ClassSwitcherModal({
  visible,
  classes,
  loading,
  error,
  currentClassId,
  onSelect,
  onRetry,
  onClose,
}: ClassSwitcherModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <ThemedText style={styles.title}>Switch class</ThemedText>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.orange} />
            </View>
          )}

          {!loading && !!error && (
            <View style={styles.center}>
              <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
              <Button title="Retry" variant="secondary" onPress={onRetry} />
            </View>
          )}

          {!loading && !error && classes.length === 0 && (
            <ThemedText variant="muted" style={styles.emptyText}>No active classes to switch to.</ThemedText>
          )}

          {!loading && !error && classes.length > 0 && (
            <FlatList
              data={classes}
              keyExtractor={(c) => c.id}
              style={styles.list}
              testID="class-switcher-list"
              renderItem={({ item }) => {
                const isCurrent = item.id === currentClassId;
                const meta = [item.grade, item.section].filter(Boolean).join(' · ');
                return (
                  <Pressable
                    onPress={() => onSelect(item)}
                    disabled={isCurrent}
                    style={[styles.row, isCurrent && { backgroundColor: colors.orangeSoft }]}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    accessibilityState={{ selected: isCurrent }}
                  >
                    <View style={styles.rowText}>
                      <ThemedText style={styles.rowName}>{item.name}</ThemedText>
                      {!!meta && <ThemedText variant="muted" style={styles.rowMeta}>{meta}</ThemedText>}
                    </View>
                    {isCurrent && <Check size={18} color={colors.orange} />}
                  </Pressable>
                );
              }}
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
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '70%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { paddingVertical: spacing.lg, textAlign: 'center' },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md, minHeight: 56, borderRadius: radius.sm, paddingHorizontal: spacing.sm,
  },
  rowText: { gap: 2 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
});
