import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../components/ThemedText';
import { useTheme } from '../theme/ThemeContext';

interface PlaceholderScreenProps {
  title: string;
  description?: string;
}

// Phase 2 stub for every screen not yet built (§26 lists which phase builds
// each one). Exists so the full navigation tree — and every route name in
// it — is real and tappable now, rather than the tree being built twice.
export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ThemedText variant="title">{title}</ThemedText>
      <ThemedText variant="muted" style={styles.description}>
        {description ?? 'Not built yet — see docs/mobile-app-plan.md for which phase adds this screen.'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  description: { textAlign: 'center' },
});
