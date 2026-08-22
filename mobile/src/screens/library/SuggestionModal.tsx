// Native port of ResourceWorkspace.tsx's AI-suggestion preview overlay — an
// AI Assist result is never applied silently; the teacher previews it here
// and explicitly Applies (replacing the editor content, not yet saved) or
// Cancels.
import React from 'react';
import { Modal, View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { MarkdownText } from '../coach/MarkdownText';

export function SuggestionModal({
  suggestion, onApply, onCancel,
}: {
  suggestion: string | null;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={suggestion != null} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={styles.header}>
            <ThemedText variant="title">Suggested revision</ThemedText>
            <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Dismiss suggestion" hitSlop={8}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          <ThemedText variant="muted" style={styles.note}>
            Review this suggestion. Applying replaces the editor content (not saved until you tap Save).
          </ThemedText>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {suggestion != null && <MarkdownText text={suggestion} />}
          </ScrollView>
          <View style={styles.actions}>
            <Button title="Cancel" variant="text" onPress={onCancel} />
            <Button title="Apply to editor" onPress={onApply} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { fontSize: 13, marginTop: spacing.xs },
  body: { marginTop: spacing.md },
  bodyContent: { paddingBottom: spacing.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
});
