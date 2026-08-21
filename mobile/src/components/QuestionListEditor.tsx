// The structured-question list — shared by the Generator's result screen and
// the Library edit workspace's structured editor (see
// docs/generator-v2-plan.md). Owns add/delete/reorder; per-question field
// editing is QuestionCard's job. Native port of client/src/components/
// QuestionListEditor.tsx.
import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { QuestionCard } from './QuestionCard';
import { ThemedText } from './ThemedText';
import { ChipPicker } from './ChipPicker';
import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/tokens';
import { EDITABLE_QUESTION_TYPES, createEmptyQuestion } from '../lib/structuredQuestions';
import type { Question, QuestionType } from '../api/resources';

export interface QuestionListEditorProps {
  questions: Question[];
  editable: boolean;
  errors?: Record<string, string>;
  onChange?: (next: Question[]) => void;
}

export function QuestionListEditor({ questions, editable, errors, onChange }: QuestionListEditorProps) {
  const { colors } = useTheme();
  const [addType, setAddType] = useState<QuestionType>('mcq');

  function updateAt(index: number, next: Question) {
    if (!onChange) return;
    const copy = [...questions];
    copy[index] = next;
    onChange(copy);
  }

  function deleteAt(index: number) {
    if (!onChange) return;
    onChange(questions.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    if (!onChange) return;
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const copy = [...questions];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  }

  function addQuestion() {
    if (!onChange) return;
    onChange([...questions, createEmptyQuestion(addType)]);
  }

  return (
    <View style={styles.container}>
      {questions.length === 0 && (
        <ThemedText variant="muted" style={styles.empty}>
          {editable ? 'No questions yet — add one below.' : 'No questions in this document.'}
        </ThemedText>
      )}

      {questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          question={q}
          index={i}
          total={questions.length}
          editable={editable}
          error={errors?.[q.id]}
          onChange={(next) => updateAt(i, next)}
          onDelete={() => deleteAt(i)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
        />
      ))}

      {editable && (
        <View style={styles.addRow}>
          <View style={styles.addPicker}>
            <ChipPicker
              label="Add a question"
              options={EDITABLE_QUESTION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              value={addType}
              onChange={(v) => setAddType(v as QuestionType)}
            />
          </View>
          <Pressable
            onPress={addQuestion}
            style={[styles.addBtn, { borderColor: colors.orange }]}
            accessibilityRole="button"
          >
            <Plus size={16} color={colors.orange} />
            <ThemedText style={{ color: colors.orange, fontWeight: '700' }}>Add question</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  empty: { fontSize: 14 },
  addRow: { gap: spacing.sm, marginTop: spacing.xs },
  addPicker: {},
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderWidth: 1.5, borderRadius: 10, paddingVertical: 12, minHeight: 44,
  },
});
