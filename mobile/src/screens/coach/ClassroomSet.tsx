// Native port of client/src/components/ClassroomSet.tsx — the set of
// classroom materials attached to one Classroom Mode turn. Owns layout only;
// the queue hook decides what is generated and when, each card owns its own
// preview and Save. This keeps MessageBubble.tsx to one conditional block,
// same containment the web version's own doc comment calls out.
import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { GraduationCap, Square } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { useClassroomQueue } from '../../lib/useClassroomQueue';
import { loadSavedArtifactIds, type SavedArtifactIds } from '../../lib/classroom';
import { ClassroomArtifactCard } from './ClassroomArtifactCard';
import type { ClassroomPlan } from '../../types';

interface ClassroomSetProps {
  plan: ClassroomPlan;
  /** True when this turn was reopened from history rather than just answered (D24). */
  restored?: boolean;
  /** The turn's persisted id — without it, generated artifacts cannot be stored/restored (D25). */
  queryId?: string;
}

export function ClassroomSet({ plan, restored = false, queryId }: ClassroomSetProps) {
  const { colors } = useTheme();
  const queue = useClassroomQueue(plan, restored, queryId);

  const [savedIds, setSavedIds] = useState<SavedArtifactIds>({});
  const [checkingSaved, setCheckingSaved] = useState(false);

  useEffect(() => {
    if (!queryId) return;
    let active = true;
    // Fetch-on-mount pattern — see CoachScreen.tsx's loadHistory effect for
    // the same already-documented case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckingSaved(true);
    loadSavedArtifactIds(queryId)
      .then((ids) => { if (active) setSavedIds(ids); })
      .catch(() => {})
      .finally(() => { if (active) setCheckingSaved(false); });
    return () => { active = false; };
  }, [queryId]);

  // The planner proposed only artifacts we cannot build yet — render nothing
  // rather than an empty "Classroom materials" heading.
  if (queue.items.length === 0) return null;

  const readyCount = queue.items.filter((i) => i.status === 'ready').length;

  return (
    <View style={[styles.set, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      <View style={styles.head}>
        <GraduationCap size={15} color={colors.orange} />
        <ThemedText style={styles.title} numberOfLines={1}>Classroom materials</ThemedText>
        <ThemedText variant="muted" style={styles.topic} numberOfLines={1}>{plan.topic}</ThemedText>
        <ThemedText variant="muted" style={styles.count} accessibilityLiveRegion="polite">
          {readyCount} of {queue.items.length} ready
        </ThemedText>
        {queue.running && (
          <Pressable onPress={queue.stop} accessibilityRole="button" accessibilityLabel="Stop" style={[styles.stopBtn, { borderColor: colors.border }]}>
            <Square size={11} color={colors.textMuted} />
            <ThemedText variant="muted" style={styles.stopText}>Stop</ThemedText>
          </Pressable>
        )}
      </View>

      <View style={styles.list}>
        {queue.items.map((item) => (
          <ClassroomArtifactCard
            key={item.artifact}
            item={item}
            plan={plan}
            onRetry={() => queue.retry(item.artifact)}
            queryId={queryId}
            savedResourceId={savedIds[item.artifact]}
            checkingSaved={checkingSaved}
          />
        ))}
      </View>

      <ThemedText variant="muted" style={styles.note}>Nothing is saved until you tap Save on a card.</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  set: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  title: { fontSize: 13, fontWeight: '700', flexShrink: 0 },
  topic: { fontSize: 13, flexShrink: 1 },
  count: { fontSize: 11, marginLeft: 'auto' },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999, paddingVertical: 3, paddingHorizontal: spacing.sm,
  },
  stopText: { fontSize: 11, fontWeight: '600' },
  list: { gap: spacing.xs },
  note: { fontSize: 11, marginTop: spacing.sm },
});
