import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/tokens';

export type ToggleTone = 'positive' | 'negative';

interface ToggleButtonProps {
  label: string;
  selected: boolean;
  tone: ToggleTone;
  onPress: () => void;
}

// Native equivalent of index.css's .classroom-att-btn primitive (§22) — the
// two-state Present/Absent building block Attendance (§13) and, restyled,
// Fees' Paid/Pending toggle (§14) both sit on top of. This component is only
// the *primitive* (selected/unselected pill); the tap-to-toggle-back-to-
// unmarked behavior described in §13 belongs to the screen that composes two
// of these, not to the primitive itself.
export function ToggleButton({ label, selected, tone, onPress }: ToggleButtonProps) {
  const { colors } = useTheme();
  const activeColor = tone === 'positive' ? colors.semantic.success.text : colors.semantic.danger.text;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.base,
        {
          borderColor: selected ? activeColor : colors.border,
          backgroundColor: selected ? activeColor : colors.surface,
        },
      ]}
    >
      <ThemedText style={{ color: selected ? '#fff' : colors.text, fontWeight: '600' }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    minHeight: 44, // §13's 44x44dp minimum touch target
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
