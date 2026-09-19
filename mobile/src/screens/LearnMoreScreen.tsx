import React from 'react';
import { View, Pressable, Linking, StyleSheet } from 'react-native';
import { FileText, ShieldCheck, ExternalLink } from 'lucide-react-native';
import { ThemedText } from '../components/ThemedText';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme/tokens';

// Reached from the account menu's "Learn more" row (ProfileMenu.tsx),
// matching the web's "Learn more" flyout (client/src/components/
// ProfileMenu.tsx) — same two links, same order. Each opens the live
// sarastech.co.in page in the device's own browser via Linking.openURL
// rather than a screen inside the app, matching the web version opening
// them in a new tab instead of navigating itself away.
export function LearnMoreScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable
          onPress={() => Linking.openURL('https://www.sarastech.co.in/terms')}
          style={styles.linkRow}
          accessibilityRole="link"
        >
          <FileText size={17} color={colors.text} />
          <ThemedText style={styles.rowLabel}>Terms of Service</ThemedText>
          <ExternalLink size={16} color={colors.textMuted} />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Pressable
          onPress={() => Linking.openURL('https://www.sarastech.co.in/privacy')}
          style={styles.linkRow}
          accessibilityRole="link"
        >
          <ShieldCheck size={17} color={colors.text} />
          <ThemedText style={styles.rowLabel}>Privacy Policy</ThemedText>
          <ExternalLink size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
  rowLabel: { flex: 1, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth },
});
