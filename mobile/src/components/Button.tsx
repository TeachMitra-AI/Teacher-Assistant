import React from 'react';
import { Pressable, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedText } from './ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'text';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// Native port of .btn-primary's orange→amber 135° gradient (index.css:71-82)
// — the product's most-repeated interactive element, called out in §22 as
// the one visual signature most worth preserving exactly (Save Attendance,
// Mark Present, Generate, Send all use this).
export function Button({ title, onPress, variant = 'primary', disabled, loading, style, testID }: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  if (variant === 'primary') {
    return (
      <Pressable onPress={onPress} disabled={isDisabled} style={[styles.pressable, style]} testID={testID}>
        {({ pressed }) => (
          <LinearGradient
            colors={[colors.orange, colors.amber]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.base, (isDisabled || pressed) && styles.pressedOrDisabled]}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryLabel}>{title}</ThemedText>}
          </LinearGradient>
        )}
      </Pressable>
    );
  }

  const isText = variant === 'text';
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        isText
          ? styles.textVariant
          : { backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
        (isDisabled || pressed) && styles.pressedOrDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <ThemedText style={isText ? { color: colors.textMuted, fontWeight: '500' } : { fontWeight: '600' }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: radius.sm },
  base: {
    borderRadius: radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // §13's 44x44dp minimum touch target
  },
  textVariant: { backgroundColor: 'transparent', minHeight: 40 },
  pressedOrDisabled: { opacity: 0.6 },
  primaryLabel: { color: '#fff', fontWeight: '600' },
});
