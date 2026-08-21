// Generic single-select chip row — the native analogue of a web <select> for
// a small closed vocabulary (Resource type, Language — docs/mobile-app-plan.md
// §26 Phase 5). Wraps rather than scrolls since every list this backs
// (RESOURCE_TYPES: 5, LANGUAGES: 10) is short enough to scan at a glance.
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export interface ChipOption {
  value: string;
  label: string;
  icon?: LucideIcon;
}

export function ChipPicker({
  label, options, value, onChange,
}: {
  label: string;
  options: ChipOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText variant="muted" style={styles.label}>{label}</ThemedText>
      <View style={styles.row}>
        {options.map((opt) => {
          const active = opt.value === value;
          const Icon = opt.icon;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[
                styles.chip,
                { borderColor: active ? colors.orange : colors.border, backgroundColor: active ? colors.orange : colors.surface2 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {Icon && <Icon size={13} color={active ? '#fff' : colors.textMuted} />}
              <ThemedText style={{ color: active ? '#fff' : colors.text, fontSize: 13, fontWeight: '600' }}>
                {opt.label}
              </ThemedText>
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 36,
  },
});
