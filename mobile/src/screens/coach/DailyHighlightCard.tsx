// Native port of client/src/components/DailyHighlight.tsx — the "Today's
// Highlight" card shown under the Coach welcome greeting. Web opens a
// portalled dialog on click (.highlight-overlay/.highlight-panel); the RN
// analogue is a transparent Modal, matching ProfileMenu.tsx's own
// Modal-over-Pressable-backdrop convention elsewhere in this app.
import React, { useState } from 'react';
import { View, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, shadow } from '../../theme/tokens';
import type { WelcomeHighlight } from '../../lib/welcome';

interface DailyHighlightCardProps {
  highlight: WelcomeHighlight;
}

export function DailyHighlightCard({ highlight }: DailyHighlightCardProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${highlight.eyebrow}: ${highlight.summary}. Show details.`}
        testID="daily-highlight-card"
        style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}
      >
        <ThemedText style={styles.emoji}>{highlight.emoji}</ThemedText>
        <View style={styles.text}>
          <ThemedText style={[styles.eyebrow, { color: colors.orange }]}>{highlight.eyebrow}</ThemedText>
          <ThemedText variant="muted" style={styles.summary} numberOfLines={2}>
            {highlight.summary}
          </ThemedText>
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.panel,
              shadow.android,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.head}>
              <ThemedText style={styles.title}>{highlight.detailTitle}</ThemedText>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                style={[styles.closeBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
              >
                <X size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.body}>
              {highlight.detailBody.split('\n\n').map((paragraph, i) => (
                <ThemedText key={i} variant="muted" style={styles.paragraph}>
                  {paragraph}
                </ThemedText>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  emoji: { fontSize: 17 },
  text: { flex: 1, gap: 1 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  summary: { fontSize: 13, lineHeight: 18 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '80%',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {},
  paragraph: { fontSize: 14, lineHeight: 21, marginBottom: spacing.md },
});
