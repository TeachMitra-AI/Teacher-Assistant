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
      <View style={[styles.userBubble, { backgroundColor: colors.orange }]}>
        <ThemedText style={styles.userText}>{turn.query}</ThemedText>
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
            style={[styles.card, styles.errorCard]}
            accessibilityRole="alert"
            accessibilityLabel={turn.error ?? 'Something went wrong'}
          >
            <ThemedText style={styles.errorText}>⚠️ {turn.error}</ThemedText>
            <Pressable onPress={() => onRetry(turn)} accessibilityRole="button" testID={`retry-${turn.id}`}>
              <ThemedText style={[styles.retryText, { color: colors.orange }]}>Try again</ThemedText>
            </Pressable>
          </View>
        )}

        {turn.status === 'done' && turn.response && (
          <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
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
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: radius.md,
    borderTopRightRadius: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  assistantRow: { alignSelf: 'stretch' },
  card: {
    borderRadius: radius.md,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorCard: { backgroundColor: '#fdeceb', borderColor: '#f3b4b0' },
  errorText: { color: '#a02622', fontSize: 14 },
  retryText: { fontWeight: '600', fontSize: 14 },
  feedbackRow: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.xs },
});
