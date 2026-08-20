// Native input primitive for auth/settings forms (docs/mobile-app-plan.md
// §26 Phase 3 mobile UI requirements: large touch targets, keyboard-friendly
// inputs, password visibility toggle, validation/error messages).
import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  help?: string;
  /** Renders a show/hide toggle and defaults secureTextEntry on. */
  isPassword?: boolean;
}

export function TextField({ label, error, help, isPassword, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.field}>
      <ThemedText variant="muted" style={styles.label}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: colors.surface2, borderColor: error ? '#e5484d' : colors.border },
        ]}
      >
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPassword && !visible}
          accessibilityLabel={label}
          {...rest}
        />
        {isPassword && (
          <Pressable
            onPress={() => setVisible((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? (
              <EyeOff size={18} color={colors.textMuted} />
            ) : (
              <Eye size={18} color={colors.textMuted} />
            )}
          </Pressable>
        )}
      </View>
      {error ? (
        <ThemedText style={styles.error}>{error}</ThemedText>
      ) : help ? (
        <ThemedText variant="muted" style={styles.help}>
          {help}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48, // comfortably above the 44dp touch-target minimum
  },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
  error: { color: '#e5484d', fontSize: 12 },
  help: { fontSize: 12 },
});
