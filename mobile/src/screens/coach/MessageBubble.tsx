// Native port of client/src/components/MessageBubble.tsx's core states
// (pending/error/done) — not a 1:1 port: edit-in-place, copy-to-clipboard,
// read-aloud, share, save-to-library and Classroom Mode are all web-only for
// this phase (see docs/mobile-app-plan.md's Phase 4 status note).
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ThumbsUp, ThumbsDown } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { RunStatus } from './RunStatus';
import { MarkdownText } from './MarkdownText';
import type { Turn } from '../../types';

interface MessageBubbleProps {
  turn: Turn;
  onRetry: (turn: Turn) => void;
  onFeedback: (turnId: string, rating: 'helpful' | 'not_helpful') => void;
}

export function MessageBubble({ turn, onRetry, onFeedback }: MessageBubbleProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.group}>
      <View style={[styles.userBubble, { backgroundColor: colors.surface2 }]}>
        <ThemedText style={[styles.userText, { color: colors.text }]}>{turn.query}</ThemedText>
      </View>

      <View style={styles.assistantRow}>
        {turn.status === 'pending' &&
          (turn.startedAt ? (
            <RunStatus startedAt={turn.startedAt} />
          ) : (
            <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <ThemedText variant="muted" accessibilityLiveRegion="polite">
                Preparing practical advice for you…
              </ThemedText>
            </View>
          ))}

        {turn.status === 'error' && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.semantic.danger.bg, borderColor: colors.semantic.danger.border },
            ]}
            accessibilityRole="alert"
            accessibilityLabel={turn.error ?? 'Something went wrong'}
          >
            <ThemedText style={{ color: colors.semantic.danger.text, fontSize: 14 }}>⚠️ {turn.error}</ThemedText>
            <Pressable onPress={() => onRetry(turn)} accessibilityRole="button" testID={`retry-${turn.id}`}>
              <ThemedText style={[styles.retryText, { color: colors.orange }]}>Try again</ThemedText>
            </Pressable>
          </View>
        )}

        {turn.status === 'done' && turn.response && (
          // No card wrapper — the web renders the answer as plain prose at
          // full column width (.ai-message-content/.response-body,
          // UI_REFINED.md §10.2), not inside a bordered surface. A bordered
          // card here also wasted ~32dp of the already-narrow reading width.
          <View style={styles.answer}>
            <MarkdownText text={turn.response.text} />
            {turn.response.queryId && (
              <View style={styles.feedbackRow}>
                <Pressable
                  onPress={() => onFeedback(turn.id, 'helpful')}
                  disabled={turn.rating !== null}
                  accessibilityRole="button"
                  accessibilityLabel="Helpful"
                  accessibilityState={{ selected: turn.rating === 'helpful' }}
                  hitSlop={8}
                  testID={`feedback-up-${turn.id}`}
                >
                  <ThumbsUp
                    size={16}
                    color={turn.rating === 'helpful' ? colors.orange : colors.textMuted}
                    fill={turn.rating === 'helpful' ? colors.orange : 'none'}
                  />
                </Pressable>
                <Pressable
                  onPress={() => onFeedback(turn.id, 'not_helpful')}
                  disabled={turn.rating !== null}
                  accessibilityRole="button"
                  accessibilityLabel="Not helpful"
                  accessibilityState={{ selected: turn.rating === 'not_helpful' }}
                  hitSlop={8}
                  testID={`feedback-down-${turn.id}`}
                >
                  <ThumbsDown
                    size={16}
                    color={turn.rating === 'not_helpful' ? colors.orange : colors.textMuted}
                    fill={turn.rating === 'not_helpful' ? colors.orange : 'none'}
                  />
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  userBubble: {
    // .user-bubble's exact radius asymmetry (index.css: "16px 16px 4px
    // 16px" — CSS shorthand order is TL/TR/BR/BL, so the tail corner is
    // bottom-right, not top-right).
    alignSelf: 'flex-end',
    maxWidth: '80%',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  userText: { fontSize: 15, lineHeight: 23 },
  assistantRow: { alignSelf: 'stretch' },
  card: {
    borderRadius: radius.md,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  answer: { gap: spacing.sm },
  retryText: { fontWeight: '600', fontSize: 14 },
  feedbackRow: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.xs },
});
