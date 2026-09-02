// Native port of client/src/components/ClassroomArtifactCard.tsx — one
// artifact in a Classroom Mode set: its progress, its preview, and its own
// Save button. Same COLLAPSED-BY-DEFAULT requirement as the web version (D11)
// — up to five generated documents land in a chat thread; expanded, they
// bury the coaching answer above them.
import React, { useState } from 'react';
import { View, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { ChevronDown, ChevronRight, Save, RefreshCw, AlertCircle, Check, Sparkles } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { stripAssessmentPreamble } from '../../lib/assessment';
import { ARTIFACT_META, artifactTitle } from '../../lib/classroom';
import { createResource } from '../../api/resources';
import { ApiError } from '../../api/client';
import { MarkdownText } from './MarkdownText';
import type { ArtifactState } from '../../lib/useClassroomQueue';
import type { ClassroomPlan } from '../../types';

interface ClassroomArtifactCardProps {
  item: ArtifactState;
  plan: ClassroomPlan;
  onRetry: () => void;
  /** The turn this artifact belongs to — recorded on the saved resource so a reopened set can tell what it already saved. */
  queryId?: string;
  /** Id of the Library resource this artifact was already saved as. Undefined means "not saved". */
  savedResourceId?: string;
  /** True until the parent knows what is already saved. */
  checkingSaved?: boolean;
}

export function ClassroomArtifactCard({
  item, plan, onRetry, queryId, savedResourceId, checkingSaved = false,
}: ClassroomArtifactCardProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locallySavedId, setLocallySavedId] = useState<string | null>(null);
  const savedId = locallySavedId ?? savedResourceId ?? null;

  const meta = ARTIFACT_META[item.artifact];
  const isReady = item.status === 'ready' && !!item.content;

  async function handleSave() {
    if (!item.content || saving || savedId) return;
    setSaving(true);
    try {
      const saved = await createResource({
        // D17: every question-shaped artifact is an `assessment`; a lesson
        // plan is the one exception (already an existing Library type).
        type: item.artifact === 'lesson_plan' ? 'lesson_plan' : 'assessment',
        title: artifactTitle(item.artifact, plan),
        grade: plan.grade || undefined,
        subject: plan.subject || undefined,
        language: plan.language,
        content: item.content,
        structured: JSON.stringify({ format: item.artifact, topic: plan.topic, source: 'classroom_mode' }),
        sourceQueryId: queryId,
      });
      setLocallySavedId(saved.id);
    } catch (err) {
      // No toast system on mobile (see MessageBubble.tsx's handleFeedback
      // comment) — Alert is the established fallback (GeneratorResultScreen's
      // handleSave uses the same pattern).
      Alert.alert('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: item.status === 'ready' ? colors.orange : colors.border }]}>
      <View style={styles.head}>
        <Pressable
          onPress={() => isReady && setExpanded((e) => !e)}
          disabled={!isReady}
          accessibilityRole="button"
          accessibilityState={{ expanded: isReady ? expanded : undefined }}
          accessibilityLabel={meta.label}
          style={styles.toggle}
        >
          {isReady ? (
            expanded ? <ChevronDown size={16} color={colors.textMuted} /> : <ChevronRight size={16} color={colors.textMuted} />
          ) : (
            <View style={styles.chevronGap} />
          )}
          <ThemedText style={styles.title} numberOfLines={1}>{meta.label}</ThemedText>
          <ClassroomCardStatus status={item.status} />
        </Pressable>

        {isReady && (
          <Pressable
            onPress={handleSave}
            disabled={saving || checkingSaved || savedId !== null}
            accessibilityRole="button"
            accessibilityLabel={savedId ? 'Saved' : 'Save to Library'}
            style={[styles.actionBtn, { borderColor: colors.border }, (saving || checkingSaved || savedId !== null) && styles.actionBtnDisabled]}
          >
            {savedId ? (
              <Check size={13} color={colors.text} />
            ) : saving ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Save size={13} color={colors.text} />
            )}
            <ThemedText style={styles.actionText}>{savedId ? 'Saved' : saving ? 'Saving…' : 'Save'}</ThemedText>
          </Pressable>
        )}

        {item.status === 'failed' && (
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" style={[styles.actionBtn, { borderColor: colors.border }]}>
            <RefreshCw size={13} color={colors.text} />
            <ThemedText style={styles.actionText}>Retry</ThemedText>
          </Pressable>
        )}

        {item.status === 'stopped' && (
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Generate" style={[styles.actionBtn, { borderColor: colors.border }]}>
            <Sparkles size={13} color={colors.text} />
            <ThemedText style={styles.actionText}>Generate</ThemedText>
          </Pressable>
        )}
      </View>

      {item.status === 'failed' && item.error && (
        <View style={styles.errorRow}>
          <AlertCircle size={13} color={colors.semantic.danger.text} />
          <ThemedText style={[styles.errorText, { color: colors.semantic.danger.text }]}>{item.error}</ThemedText>
        </View>
      )}

      {isReady && !expanded && (
        <ThemedText variant="muted" style={styles.hint}>{meta.hint}</ThemedText>
      )}

      {isReady && expanded && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          <MarkdownText text={stripAssessmentPreamble(item.content!) || ''} />
        </View>
      )}
    </View>
  );
}

function ClassroomCardStatus({ status }: { status: ArtifactState['status'] }) {
  const { colors } = useTheme();
  if (status === 'generating') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <ThemedText variant="muted" style={styles.statusText}>Creating…</ThemedText>
      </View>
    );
  }
  if (status === 'waiting') return <ThemedText variant="muted" style={styles.statusText}>Queued</ThemedText>;
  if (status === 'stopped') return null;
  if (status === 'failed') return <ThemedText style={[styles.statusText, { color: colors.semantic.danger.text }]}>Failed</ThemedText>;
  return <ThemedText style={[styles.statusText, { color: colors.orange, fontWeight: '700' }]}>Ready</ThemedText>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  chevronGap: { width: 16 },
  title: { fontSize: 13, fontWeight: '700', flexShrink: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 11, fontWeight: '600' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm,
    paddingVertical: 5, paddingHorizontal: spacing.sm,
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionText: { fontSize: 12, fontWeight: '600' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: spacing.sm, marginBottom: spacing.sm },
  errorText: { fontSize: 12, flexShrink: 1 },
  hint: { fontSize: 12, marginHorizontal: spacing.sm, marginBottom: spacing.sm, marginLeft: 28 },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
});
