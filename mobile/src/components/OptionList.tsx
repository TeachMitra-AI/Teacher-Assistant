// Vertically-stacked single-select list, each row an optional label + hint
// — the native analogue of the web's `.style-grid`/`.style-option` (Settings'
// response style, Help & Support's bug/feedback category pickers). Distinct
// from ChipPicker (a horizontal row of short pill labels with no hint) and
// from SelectField (a closed-until-tapped dropdown) — this is for a SHORT
// list (4-7 options) meant to be fully visible and scannable at once.
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export interface ListOption {
  value: string;
  label: string;
  hint?: string;
}

interface OptionListProps {
  label: string;
  options: ListOption[];
  value: string;
  onChange: (next: string) => void;
}

export function OptionList({ label, options, value, onChange }: OptionListProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText variant="muted" style={styles.label}>{label}</ThemedText>
      <View style={styles.list}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                styles.row,
                { borderColor: active ? colors.orange : colors.border, backgroundColor: active ? colors.orangeSoft : colors.surface2 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <ThemedText style={styles.rowLabel}>{opt.label}</ThemedText>
              {!!opt.hint && <ThemedText variant="muted" style={styles.rowHint}>{opt.hint}</ThemedText>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600' },
  list: { gap: spacing.xs },
  row: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, gap: 2 },
  rowLabel: { fontSize: 14, fontWeight: '600' },
  rowHint: { fontSize: 12 },
});
