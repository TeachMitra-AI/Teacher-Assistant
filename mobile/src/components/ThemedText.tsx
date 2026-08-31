import React from 'react';
import { Text, type TextProps, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export type TextVariant = 'title' | 'body' | 'muted';

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
}

// System font stack only, matching index.css:64's "no custom web font"
// choice (§22) — React Native's 'System' family maps to San Francisco/Roboto.
// The one deviation is `theme/tokens.ts`'s `paper` theme, which sets
// colors.fontFamily to a serif stack for the exam-paper preview (mirroring
// index.css:4227's `.workspace-preview.exam-paper` font-family override) —
// every other theme leaves it undefined and this falls through to 'System'.
export function ThemedText({ variant = 'body', style, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const variantStyle =
    variant === 'title' ? styles.title : variant === 'muted' ? { color: colors.textMuted } : null;
  return (
    <Text
      style={[{ color: colors.text }, colors.fontFamily ? { fontFamily: colors.fontFamily } : null, variantStyle, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700' },
});
