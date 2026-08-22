// A row of tap-to-fill suggestions for a free-text field (Grade/Subject) —
// the native analogue of a web <datalist>, which has no RN equivalent.
// Unlike ChipPicker this tracks no selection state of its own: tapping a
// chip just fills the field, and the teacher can still type anything else.
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export function SuggestionChips({ options, onSelect }: { options: string[]; onSelect: (value: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => onSelect(opt)}
          style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface2 }]}
          accessibilityRole="button"
        >
          <ThemedText variant="muted" style={styles.label}>{opt}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  label: { fontSize: 12 },
});
