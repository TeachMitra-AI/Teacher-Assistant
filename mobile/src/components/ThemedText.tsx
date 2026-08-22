import React from 'react';
import { Text, type TextProps, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export type TextVariant = 'title' | 'body' | 'muted';

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
}

// System font stack only, matching index.css:64's "no custom web font"
// choice (§22) — React Native's 'System' family maps to San Francisco/Roboto.
export function ThemedText({ variant = 'body', style, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const variantStyle =
    variant === 'title' ? styles.title : variant === 'muted' ? { color: colors.textMuted } : null;
  return <Text style={[{ color: colors.text }, variantStyle, style]} {...rest} />;
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700' },
});
