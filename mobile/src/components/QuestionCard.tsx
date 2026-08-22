// One structured question, rendered either as an editable card (Generator's
// result screen / the Library edit workspace's structured editor) or a
// read-only card (Preview) — see docs/generator-v2-plan.md. Kept as one
// component for both modes so the two never visually drift apart; `editable`
// decides which controls render. Native port of client/src/components/
// QuestionCard.tsx — same behavior, RN primitives instead of DOM.
import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { ChevronUp, ChevronDown, Trash2, Plus, Check } from 'lucide-react-native';
import { ThemedText } from './ThemedText';
import { ChipPicker } from './ChipPicker';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import { EDITABLE_QUESTION_TYPES } from '../lib/structuredQuestions';
import type { MatchQuestion, McqQuestion, MatchPair, Question, QuestionType } from '../api/resources';

const TYPE_LABELS: Record<string, string> = Object.fromEntries(EDITABLE_QUESTION_TYPES.map((t) => [t.value, t.label]));
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export interface QuestionCardProps {
  question: Question;
  index: number;
  total: number;
  editable: boolean;
  error?: string | null;
  onChange?: (next: Question) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function QuestionCard({
  question, index, total, editable, error, onChange, onDelete, onMoveUp, onMoveDown,
}: QuestionCardProps) {
  const { colors } = useTheme();

  function patch(fields: Partial<Question>) {
    onChange?.({ ...question, ...fields } as Question);
  }

  function changeType(nextType: QuestionType) {
    if (!onChange || nextType === question.type) return;
    const text = question.text;
    const id = question.id;
    if (nextType === 'mcq') onChange({ id, type: 'mcq', text, options: ['', '', '', ''], correctOptionIndex: 0 });
    else if (nextType === 'true_false') onChange({ id, type: 'true_false', text, correctAnswer: 'True' });
    else if (nextType === 'descriptive') onChange({ id, type: 'descriptive', text, modelAnswer: '' });
    else if (nextType === 'fill_blank') onChange({ id, type: 'fill_blank', text, correctAnswer: '' });
    else if (nextType === 'match') {
      onChange({ id, type: 'match', text, pairs: [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }] });
    } else onChange({ id, type: 'short_answer', text, correctAnswer: '' });
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: error ? '#e5484d' : colors.border }]}>
      <View style={styles.head}>
        <ThemedText variant="muted" style={styles.number}>{`Q${index + 1}`}</ThemedText>
        {editable ? (
          <View style={styles.typePicker}>
            <ChipPicker
              label=""
              options={EDITABLE_QUESTION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              value={question.type}
              onChange={(v) => changeType(v as QuestionType)}
            />
          </View>
        ) : (
          <View style={[styles.typeBadge, { backgroundColor: colors.orange + '22' }]}>
            <ThemedText style={{ color: colors.orange, fontWeight: '700', fontSize: 11 }}>
              {(TYPE_LABELS[question.type] || question.type).toUpperCase()}
            </ThemedText>
          </View>
        )}
        {editable && (
          <View style={styles.actions}>
            <Pressable
              onPress={onMoveUp}
              disabled={index === 0}
              style={[styles.iconBtn, index === 0 && styles.iconBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={`Move question ${index + 1} up`}
            >
              <ChevronUp size={17} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={onMoveDown}
              disabled={index === total - 1}
              style={[styles.iconBtn, index === total - 1 && styles.iconBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={`Move question ${index + 1} down`}
            >
              <ChevronDown size={17} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={onDelete}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={`Delete question ${index + 1}`}
            >
              <Trash2 size={17} color="#e5484d" />
            </Pressable>
          </View>
        )}
      </View>

      {editable ? (
        <TextInput
          style={[styles.textInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
          value={question.text}
          onChangeText={(t) => patch({ text: t })}
          placeholder={question.type === 'fill_blank' ? 'e.g. The capital of France is ___.' : 'Question text'}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          accessibilityLabel={`Question ${index + 1} text`}
        />
      ) : (
        <ThemedText style={styles.textDisplay}>{question.text || '(No question text)'}</ThemedText>
      )}

      {question.type === 'mcq' && <McqFields question={question} editable={editable} index={index} onChange={onChange} />}

      {question.type === 'true_false' && (
        editable ? (
          <View style={styles.field}>
            <ThemedText variant="muted" style={styles.label}>Correct answer</ThemedText>
            <ChipPicker
              label=""
              options={[{ value: 'True', label: 'True' }, { value: 'False', label: 'False' }]}
              value={question.correctAnswer}
              onChange={(v) => patch({ correctAnswer: v as 'True' | 'False' })}
            />
          </View>
        ) : (
          <ThemedText variant="muted" style={styles.answer}>Correct answer: <ThemedText style={styles.bold}>{question.correctAnswer}</ThemedText></ThemedText>
        )
      )}

      {(question.type === 'short_answer' || question.type === 'fill_blank') && (
        editable ? (
          <View style={styles.field}>
            <ThemedText variant="muted" style={styles.label}>
              {question.type === 'fill_blank' ? 'Answer for the blank' : 'Correct answer'}
            </ThemedText>
            <TextInput
              style={[styles.singleInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              value={question.correctAnswer}
              onChangeText={(t) => patch({ correctAnswer: t })}
              placeholder={question.type === 'fill_blank' ? 'e.g. Paris' : 'Model answer'}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={question.type === 'fill_blank' ? `Question ${index + 1} answer for the blank` : `Question ${index + 1} correct answer`}
            />
          </View>
        ) : (
          <ThemedText variant="muted" style={styles.answer}>
            {question.type === 'fill_blank' ? 'Answer' : 'Correct answer'}: <ThemedText style={styles.bold}>{question.correctAnswer || '—'}</ThemedText>
          </ThemedText>
        )
      )}

      {question.type === 'descriptive' && (
        editable ? (
          <View style={styles.field}>
            <ThemedText variant="muted" style={styles.label}>Model answer</ThemedText>
            <TextInput
              style={[styles.textInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              value={question.modelAnswer}
              onChangeText={(t) => patch({ modelAnswer: t })}
              placeholder="A suggested answer a teacher could grade against"
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              accessibilityLabel={`Question ${index + 1} model answer`}
            />
          </View>
        ) : (
          <ThemedText variant="muted" style={styles.answer}>Suggested answer: {question.modelAnswer || '—'}</ThemedText>
        )
      )}

      {question.type === 'match' && <MatchFields question={question} editable={editable} index={index} onChange={onChange} />}

      {editable && error && <ThemedText style={styles.error}>{error}</ThemedText>}
    </View>
  );
}

function McqFields({
  question, editable, index, onChange,
}: { question: McqQuestion; editable: boolean; index: number; onChange?: (next: Question) => void }) {
  const { colors } = useTheme();

  function setOption(i: number, value: string) {
    if (!onChange) return;
    const options = [...question.options];
    options[i] = value;
    onChange({ ...question, options });
  }

  return (
    <View style={styles.options}>
      {question.options.map((opt, i) => {
        const isCorrect = question.correctOptionIndex === i;
        return (
          <View key={i} style={styles.optionRow}>
            <Pressable
              onPress={() => editable && onChange?.({ ...question, correctOptionIndex: i })}
              disabled={!editable}
              style={[
                styles.radio,
                { borderColor: isCorrect ? colors.orange : colors.border, backgroundColor: isCorrect ? colors.orange : 'transparent' },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isCorrect, disabled: !editable }}
              accessibilityLabel={`Option ${OPTION_LETTERS[i]} is correct`}
            >
              {isCorrect && <Check size={11} color="#fff" />}
            </Pressable>
            <ThemedText variant="muted" style={styles.optionLetter}>{OPTION_LETTERS[i]}</ThemedText>
            {editable ? (
              <TextInput
                style={[styles.optionInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                value={opt}
                onChangeText={(t) => setOption(i, t)}
                placeholder={`Option ${OPTION_LETTERS[i]}`}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={`Question ${index + 1} option ${OPTION_LETTERS[i]}`}
              />
            ) : (
              <ThemedText style={[styles.optionText, isCorrect && { color: colors.orange, fontWeight: '700' }]}>
                {opt || '(empty)'}
              </ThemedText>
            )}
          </View>
        );
      })}
    </View>
  );
}

function MatchFields({
  question, editable, index, onChange,
}: { question: MatchQuestion; editable: boolean; index: number; onChange?: (next: Question) => void }) {
  const { colors } = useTheme();

  function setPair(i: number, side: 'left' | 'right', value: string) {
    if (!onChange) return;
    const pairs = question.pairs.map((p, idx) => (idx === i ? { ...p, [side]: value } : p));
    onChange({ ...question, pairs });
  }
  function addPair() {
    if (!onChange || question.pairs.length >= 8) return;
    onChange({ ...question, pairs: [...question.pairs, { left: '', right: '' }] });
  }
  function removePair(i: number) {
    if (!onChange || question.pairs.length <= 3) return;
    onChange({ ...question, pairs: question.pairs.filter((_, idx) => idx !== i) });
  }

  if (!editable) {
    return (
      <View style={[styles.matchTable, { borderColor: colors.border }]}>
        <View style={[styles.matchRow, styles.matchHeaderRow, { borderColor: colors.border }]}>
          <ThemedText variant="muted" style={[styles.matchCell, styles.matchHeaderText]}>Column A</ThemedText>
          <ThemedText variant="muted" style={[styles.matchCell, styles.matchHeaderText]}>Column B</ThemedText>
        </View>
        {question.pairs.map((p: MatchPair, i) => (
          <View key={i} style={[styles.matchRow, { borderColor: colors.border }]}>
            <ThemedText style={styles.matchCell}>{p.left || '—'}</ThemedText>
            <ThemedText style={styles.matchCell}>{p.right || '—'}</ThemedText>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.matchEditor}>
      {question.pairs.map((p, i) => (
        <View key={i} style={styles.matchEditRow}>
          <TextInput
            style={[styles.matchInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            value={p.left}
            onChangeText={(t) => setPair(i, 'left', t)}
            placeholder="Column A"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={`Question ${index + 1} match pair ${i + 1} left`}
          />
          <ThemedText variant="muted" style={styles.matchArrow}>↔</ThemedText>
          <TextInput
            style={[styles.matchInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            value={p.right}
            onChangeText={(t) => setPair(i, 'right', t)}
            placeholder="Column B"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={`Question ${index + 1} match pair ${i + 1} right`}
          />
          <Pressable
            onPress={() => removePair(i)}
            disabled={question.pairs.length <= 3}
            style={[styles.matchRemove, question.pairs.length <= 3 && styles.iconBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Remove pair ${i + 1}`}
          >
            <Trash2 size={15} color="#e5484d" />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={addPair}
        disabled={question.pairs.length >= 8}
        style={[styles.addPair, question.pairs.length >= 8 && styles.iconBtnDisabled]}
        accessibilityRole="button"
      >
        <Plus size={14} color={colors.orange} />
        <ThemedText style={{ color: colors.orange, fontWeight: '600', fontSize: 13 }}>Add pair</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  number: { fontWeight: '700', fontSize: 13 },
  typePicker: { flex: 1, minWidth: 160 },
  typeBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 999 },
  actions: { flexDirection: 'row', gap: 2, marginLeft: 'auto' },
  iconBtn: { padding: spacing.xs, minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  iconBtnDisabled: { opacity: 0.35 },
  textInput: {
    minHeight: 60, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm,
    padding: spacing.sm, fontSize: 15, lineHeight: 20,
  },
  textDisplay: { fontSize: 15, lineHeight: 21 },
  field: { gap: spacing.xs },
  label: { fontSize: 12, fontWeight: '600' },
  answer: { fontSize: 13, marginTop: 2 },
  bold: { fontWeight: '700' },
  error: { color: '#e5484d', fontSize: 12 },
  singleInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.sm, fontSize: 15 },
  options: { gap: spacing.xs },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  optionLetter: { fontWeight: '700', fontSize: 13, minWidth: 14 },
  optionInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 14 },
  optionText: { flex: 1, fontSize: 14 },
  matchEditor: { gap: spacing.xs },
  matchEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  matchInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: 14 },
  matchArrow: { fontSize: 14 },
  matchRemove: { padding: spacing.xs, minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  addPair: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: spacing.xs, marginTop: 2 },
  matchTable: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  matchRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  matchHeaderRow: { borderTopWidth: 0 },
  matchHeaderText: { fontWeight: '700', fontSize: 11, textTransform: 'uppercase' },
  matchCell: { flex: 1, fontSize: 13, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
