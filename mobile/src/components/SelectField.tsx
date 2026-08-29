// Generic single-select dropdown — a tappable field that opens a bottom
// sheet listing every option (same Modal-over-Pressable-backdrop sheet
// pattern as ClassSwitcherModal.tsx), rather than ChipPicker's always-visible
// row or a free-text field with tap-to-fill suggestions. Used where a field
// should only ever hold one of a fixed set of values.
import React, { useState } from 'react';
import { View, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Check } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export function SelectField({ label, options, value, onChange, placeholder = 'Select…' }: SelectFieldProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.field}>
      <ThemedText variant="muted" style={styles.label}>{label}</ThemedText>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.inputWrap, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <ThemedText style={[styles.value, { color: selected ? colors.text : colors.textMuted }]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </ThemedText>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <ThemedText style={styles.title}>{label}</ThemedText>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={styles.list}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <Pressable
                    onPress={() => { onChange(item.value); setOpen(false); }}
                    style={[styles.row, active && { backgroundColor: colors.orangeSoft }]}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                  >
                    <ThemedText style={styles.rowLabel}>{item.label}</ThemedText>
                    {active && <Check size={18} color={colors.orange} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  value: { fontSize: 16, flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '70%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md, minHeight: 48, borderRadius: radius.sm, paddingHorizontal: spacing.sm,
  },
  rowLabel: { fontSize: 15 },
});
