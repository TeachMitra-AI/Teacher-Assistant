import React from 'react';
import { View, type ViewProps, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { radius, shadow } from '../theme/tokens';

// Native translation of index.css's card surfaces (--radius, --shadow — §22).
export function Card({ style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: colors.surface, borderColor: colors.border },
        Platform.OS === 'ios' ? shadow.ios : shadow.android,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
});
