// Native port of ResourceWorkspace.tsx's AI_ACTIONS row (docs/mobile-app-plan.md
// §26 Phase 5) — over the already-ported POST /resources/:id/ai-action
// contract (api/resources.ts's runAiAction, Phase 1). Presentational only:
// ResourceEditScreen owns the request/suggestion-preview state.
import React, { useState } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Wand2, Puzzle, ClipboardCheck, GraduationCap, TrendingDown, TrendingUp, ListPlus, Type } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { ChipPicker } from '../../components/ChipPicker';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { GRADES } from '../../config';
import type { AiActionId } from '../../api/resources';

interface AiActionDef {
  id: AiActionId;
  label: string;
  icon: LucideIcon;
  needsGrade?: boolean;
  assessmentOnly?: boolean;
}

const AI_ACTIONS: AiActionDef[] = [
  { id: 'simplify', label: 'Make it simpler', icon: Wand2 },
  { id: 'add_activities', label: 'Add classroom activities', icon: Puzzle },
  { id: 'add_assessment', label: 'Add assessment questions', icon: ClipboardCheck },
  { id: 'adapt_grade', label: 'Adapt for another grade', icon: GraduationCap, needsGrade: true },
  { id: 'make_easier', label: 'Make easier', icon: TrendingDown, assessmentOnly: true },
  { id: 'make_harder', label: 'Make harder', icon: TrendingUp, assessmentOnly: true },
  { id: 'more_questions', label: 'Generate more questions', icon: ListPlus, assessmentOnly: true },
  { id: 'simplify_wording', label: 'Simplify wording', icon: Type, assessmentOnly: true },
];

export function AiAssistSection({
  isAssessment, busy, onRun,
}: {
  isAssessment: boolean;
  busy: AiActionId | null;
  onRun: (action: AiActionId, targetGrade?: string) => void;
}) {
  const { colors } = useTheme();
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptGrade, setAdaptGrade] = useState('');

  return (
    <View style={styles.container}>
      <ThemedText variant="title" style={styles.title}>AI Assist</ThemedText>
      <ThemedText variant="muted" style={styles.hint}>Generate a suggested revision — you preview and apply it yourself.</ThemedText>

      <View style={styles.actions}>
        {AI_ACTIONS.filter((a) => !a.assessmentOnly || isAssessment).map((a) => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <Pressable
              key={a.id}
              disabled={!!busy}
              onPress={() => (a.needsGrade ? setAdaptOpen((o) => !o) : onRun(a.id))}
              style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surface2, opacity: busy && !isBusy ? 0.5 : 1 }]}
              accessibilityRole="button"
              testID={`ai-action-${a.id}`}
            >
              {isBusy ? <ActivityIndicator size="small" color={colors.text} /> : <Icon size={15} color={colors.text} />}
              <ThemedText style={styles.actionLabel}>{a.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {adaptOpen && (
        <View style={styles.adapt}>
          <ChipPicker
            label="Target grade"
            options={GRADES.map((g) => ({ value: g, label: g }))}
            value={adaptGrade}
            onChange={setAdaptGrade}
          />
          <Button
            title={busy === 'adapt_grade' ? 'Generating…' : 'Generate'}
            onPress={() => onRun('adapt_grade', adaptGrade)}
            disabled={!adaptGrade || !!busy}
            loading={busy === 'adapt_grade'}
            style={styles.generateBtn}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, marginTop: spacing.lg },
  title: { fontSize: 16 },
  hint: { fontSize: 13, marginBottom: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionLabel: { fontSize: 13, fontWeight: '500' },
  adapt: { marginTop: spacing.sm, gap: spacing.sm },
  generateBtn: { alignSelf: 'flex-start', paddingHorizontal: spacing.xl },
});
