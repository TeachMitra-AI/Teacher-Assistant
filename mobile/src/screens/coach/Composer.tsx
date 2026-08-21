// Native composer: single-line-growing TextInput + send button (docs/mobile-app-plan.md
// §26 Phase 4 mobile-UI checklist: input composer, send button, touch
// targets). Deliberately narrower than client/src/components/Composer.tsx —
// no attachments/voice/Classroom Mode controls; see docs/mobile-app-plan.md's
// Phase 4 status note for why those are out of scope this phase.
import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { MAX_QUERY_LENGTH } from '../../config';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function Composer({ value, onChange, onSubmit, loading }: ComposerProps) {
  const { colors } = useTheme();
  const canSend = !loading && value.trim().length > 0;
  const showCharCount = value.length > MAX_QUERY_LENGTH * 0.8;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {showCharCount && (
        <ThemedText
          variant="muted"
          style={[styles.charCount, value.length > MAX_QUERY_LENGTH * 0.9 && { color: '#e5484d' }]}
          accessibilityLiveRegion="polite"
        >
          {value.length}/{MAX_QUERY_LENGTH}
        </ThemedText>
      )}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={(text) => onChange(text.slice(0, MAX_QUERY_LENGTH))}
          placeholder="Ask anything about teaching…"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={MAX_QUERY_LENGTH}
          accessibilityLabel="Your question"
          testID="coach-composer-input"
        />
        <Pressable
          onPress={onSubmit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send question"
          testID="coach-composer-send"
          style={[styles.send, { backgroundColor: canSend ? colors.orange : colors.surface2 }]}
        >
          <ArrowUp size={20} color={canSend ? '#fff' : colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  charCount: { fontSize: 11, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  send: {
    width: 44, // §13's 44x44dp minimum touch target
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
