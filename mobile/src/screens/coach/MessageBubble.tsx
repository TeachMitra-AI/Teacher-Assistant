// Native port of client/src/components/MessageBubble.tsx's core states
// (pending/error/done), now including edit-in-place — not a 1:1 port:
// copy-to-clipboard, read-aloud, share, save-to-library and Classroom Mode
// are still web-only for this phase (see docs/mobile-app-plan.md's Phase 4
// status note; copy-to-clipboard needs a native module (expo-clipboard) not
// currently installed, deliberately not added just for this).
import React, { useState } from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { ThumbsUp, ThumbsDown, Pencil } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { MAX_QUERY_LENGTH } from '../../config';
import { RunStatus } from './RunStatus';
import { MarkdownText } from './MarkdownText';
import type { Turn } from '../../types';

interface MessageBubbleProps {
  turn: Turn;
  onRetry: (turn: Turn) => void;
  onFeedback: (turnId: string, rating: 'helpful' | 'not_helpful') => void;
  onEdit: (turnId: string, query: string) => void;
}

export function MessageBubble({ turn, onRetry, onFeedback, onEdit }: MessageBubbleProps) {
  const { colors } = useTheme();
  // Local draft — never touches turn.query until Save, so Cancel is always
  // just "throw the draft away" (mirrors web's MessageBubble.tsx exactly).
  // Not offered mid-flight (status === 'pending'), same as web's canEdit
  // guard (web's other half of that guard, !hasAttachments, doesn't apply —
  // mobile Coach has no attachment feature to conflict with).
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(turn.query);
  const canEdit = turn.status !== 'pending';

  function startEdit() {
    setDraft(turn.query);
    setIsEditing(true);
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEdit(turn.id, trimmed);
  }

  return (
    <View style={styles.group}>
      {isEditing ? (
        <View style={[styles.editBox, { backgroundColor: colors.surface2, borderColor: colors.orange }]}>
          <TextInput
            style={[styles.editInput, { color: colors.text }]}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={MAX_QUERY_LENGTH}
            autoFocus
            accessibilityLabel="Edit your question"
            testID={`edit-input-${turn.id}`}
          />
          <View style={styles.editActions}>
            <Button title="Cancel" variant="text" onPress={() => setIsEditing(false)} testID={`edit-cancel-${turn.id}`} />
            <Button title="Save" onPress={saveEdit} disabled={!draft.trim()} testID={`edit-save-${turn.id}`} />
          </View>
        </View>
      ) : (
        <View style={styles.userRow}>
          {canEdit && (
            <Pressable
              onPress={startEdit}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Edit message"
              testID={`edit-start-${turn.id}`}
              style={styles.editBtn}
            >
              <Pencil size={13} color={colors.textMuted} />
            </Pressable>
          )}
          <View style={[styles.userBubble, { backgroundColor: colors.surface2 }]}>
            <ThemedText style={[styles.userText, { color: colors.text }]}>{turn.query}</ThemedText>
          </View>
        </View>
      )}

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
  // maxWidth lives here, not on userBubble below, so the 80%-of-screen cap
  // applies to the pencil icon + bubble together — the bubble itself just
  // shrinks/wraps to fill whatever the row has left (flexShrink: 1 below).
  userRow: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'flex-end', gap: spacing.xs, maxWidth: '80%' },
  editBtn: { padding: spacing.xs },
  editBox: {
    alignSelf: 'stretch', borderRadius: radius.md, borderWidth: 1.5, padding: spacing.sm, gap: spacing.sm,
  },
  editInput: { fontSize: 15, lineHeight: 23, maxHeight: 160, padding: 0 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs },
  userBubble: {
    // .user-bubble's exact radius asymmetry (index.css: "16px 16px 4px
    // 16px" — CSS shorthand order is TL/TR/BR/BL, so the tail corner is
    // bottom-right, not top-right).
    flexShrink: 1,
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
