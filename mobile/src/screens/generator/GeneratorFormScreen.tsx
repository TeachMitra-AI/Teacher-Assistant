// Native Generator form (Generator v2 Stage 3 — docs/generator-v2-plan.md,
// docs/mobile-app-plan.md Phase 6). Mirrors client/src/pages/GeneratorPage.tsx's
// request fields exactly (same closed vocabularies from ../../config, same
// generateAssessment call) — this screen owns only the request; the result/
// edit/save flow lives in GeneratorResultScreen, reached by pushing a new
// screen rather than swapping tabs in place (this repo's native-navigation
// idiom, not a port of the web page's single-page tab switch). The AI Action
// Router prefill integration on web (GeneratorPage.tsx's provenance/banner
// state) is deliberately not ported — nothing in the mobile app plan scopes
// that feature for mobile, and reusing the router would require a mobile
// deep-link/handle contract that doesn't exist yet.
import React, { useState } from 'react';
import {
  View, ScrollView, KeyboardAvoidingView, Platform, Pressable, TextInput, Modal, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Sparkles, Minus, Plus, ChevronDown, Check } from 'lucide-react-native';
import type { GeneratorStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { ChipPicker } from '../../components/ChipPicker';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { generateAssessment, type GenerateAssessmentInput, type AssessmentFormat, type Difficulty, type QuestionType, type QuestionTypeSelection } from '../../api/resources';
import { ApiError } from '../../api/client';
import {
  ASSESSMENT_FORMATS, DIFFICULTIES, QUESTION_TYPES, LANGUAGES, GRADES, SUBJECTS,
  QUESTION_COUNT_MIN, QUESTION_COUNT_MAX, QUESTION_COUNT_DEFAULT,
} from '../../config';

type Props = NativeStackScreenProps<GeneratorStackParamList, 'GeneratorForm'>;

export function GeneratorFormScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [format, setFormat] = useState<AssessmentFormat>('quiz');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  // Issue #95: a teacher can tick more than one specific type via the
  // dropdown checklist below. The array can go empty (unticking the last
  // one) — handleGenerate validates that the same way it validates a blank
  // topic — and collapses back to a bare value on submit when only one is
  // picked (see questionTypePayload), matching web's GeneratorPage.tsx
  // exactly.
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>(['mcq']);
  const [questionTypeOpen, setQuestionTypeOpen] = useState(false);
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNT_DEFAULT);
  // Mirrors questionCount as free-typed text so the field can hold an
  // in-progress/out-of-range value (e.g. an empty string, or "1" while
  // typing "15") without the +/- clamp fighting the keyboard on every
  // keystroke. Clamped back into questionCount on blur.
  const [questionCountText, setQuestionCountText] = useState(String(QUESTION_COUNT_DEFAULT));
  const [language, setLanguage] = useState('en');
  const [instructions, setInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  function clampCount(n: number) {
    return Math.min(QUESTION_COUNT_MAX, Math.max(QUESTION_COUNT_MIN, n));
  }

  // Toggles one question type on/off (issue #95). "Mixed" is exclusive with
  // every other type — ticking it clears/replaces the whole selection, and
  // it's the only row left enabled in the checklist while it's active (see
  // the `disabled` prop below); ticking a specific type while "Mixed" is
  // active starts a fresh, non-mixed selection instead of appending to it.
  // The result can go empty (unticking the last row) — handleGenerate
  // validates that the same way it already validates a blank topic.
  function toggleQuestionType(value: QuestionType) {
    setQuestionTypes((prev) => {
      if (value === 'mixed') return prev.includes('mixed') ? [] : ['mixed'];
      if (prev.includes(value)) return prev.filter((t) => t !== value);
      if (prev.includes('mixed')) return [value];
      return [...prev, value];
    });
  }

  // Collapses the picker's array back to a bare value when only one type is
  // selected — the single-select request/prompt the server has always seen.
  function questionTypePayload(types: QuestionType[]): QuestionTypeSelection {
    return types.length === 1 ? types[0] : types;
  }

  // What the closed dropdown field shows — the selected labels joined, or a
  // placeholder once every type has been unticked (handleGenerate is what
  // actually blocks submitting that state, same as a blank topic).
  const questionTypeSummary = questionTypes.length === 0
    ? 'Select question types'
    : questionTypes.map((t) => QUESTION_TYPES.find((q) => q.value === t)?.label ?? t).join(', ');

  function adjustCount(delta: number) {
    setQuestionCount((n) => {
      const next = clampCount(n + delta);
      setQuestionCountText(String(next));
      return next;
    });
  }

  function handleCountChangeText(text: string) {
    const digits = text.replace(/[^0-9]/g, '');
    setQuestionCountText(digits);
    if (digits !== '') setQuestionCount(Number(digits));
  }

  function handleCountBlur() {
    const clamped = clampCount(Number(questionCountText) || QUESTION_COUNT_MIN);
    setQuestionCount(clamped);
    setQuestionCountText(String(clamped));
  }

  async function handleGenerate() {
    if (generating || !topic.trim() || questionTypes.length === 0) return;
    // Clamp here too, not just on blur — Generate can be pressed while the
    // count field is still focused with an out-of-range typed value.
    const count = clampCount(Number(questionCountText) || QUESTION_COUNT_MIN);
    setQuestionCount(count);
    setQuestionCountText(String(count));
    setGenerating(true);
    setError('');
    const questionType = questionTypePayload(questionTypes);
    const input: GenerateAssessmentInput = {
      format,
      grade: grade.trim() || undefined,
      subject: subject.trim() || undefined,
      topic: topic.trim(),
      difficulty,
      questionType,
      questionCount: count,
      language,
      instructions: instructions.trim() || undefined,
    };
    try {
      const result = await generateAssessment(input);
      navigation.navigate('GeneratorResult', {
        format, grade: grade.trim(), subject: subject.trim(), topic: topic.trim(),
        difficulty, questionType, questionCount: count, language,
        content: result.content,
        structured: result.structured,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText variant="muted">
          Generate a classroom-ready quiz or worksheet with AI, review it, then save it to your Library.
        </ThemedText>

        <ChipPicker
          label="Format"
          options={ASSESSMENT_FORMATS.map((f) => ({ value: f.value, label: f.label, icon: f.icon }))}
          value={format}
          onChange={(v) => setFormat(v as AssessmentFormat)}
        />

        <TextField
          label="Topic *"
          value={topic}
          onChangeText={setTopic}
          maxLength={200}
          placeholder="e.g. Fractions, Water cycle, Parts of speech"
        />

        <SelectField
          label="Grade"
          placeholder="Any grade"
          options={GRADES.map((g) => ({ value: g, label: g }))}
          value={grade}
          onChange={setGrade}
        />

        <SelectField
          label="Subject"
          placeholder="Any subject"
          options={SUBJECTS.map((s) => ({ value: s, label: s }))}
          value={subject}
          onChange={setSubject}
        />

        <SelectField
          label="Difficulty"
          options={DIFFICULTIES}
          value={difficulty}
          onChange={(v) => setDifficulty(v as Difficulty)}
        />

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.label}>Question type</ThemedText>
          <Pressable
            onPress={() => setQuestionTypeOpen(true)}
            style={[styles.typeFieldWrap, { backgroundColor: colors.surface2, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Question type"
          >
            <ThemedText style={styles.typeFieldValue} numberOfLines={1}>{questionTypeSummary}</ThemedText>
            <ChevronDown size={18} color={colors.textMuted} />
          </Pressable>

          <Modal visible={questionTypeOpen} transparent animationType="fade" onRequestClose={() => setQuestionTypeOpen(false)}>
            <Pressable style={styles.typeOverlay} onPress={() => setQuestionTypeOpen(false)} accessibilityLabel="Close">
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={[
                  styles.typeSheet,
                  { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
                ]}
              >
                <View style={[styles.typeHandle, { backgroundColor: colors.border }]} />
                <View style={styles.typeSheetHeader}>
                  <ThemedText style={styles.typeSheetTitle}>Question type</ThemedText>
                  <Pressable onPress={() => setQuestionTypeOpen(false)} accessibilityRole="button" accessibilityLabel="Done">
                    <ThemedText style={{ color: colors.orange, fontWeight: '700', fontSize: 15 }}>Done</ThemedText>
                  </Pressable>
                </View>
                <ScrollView style={styles.typeList}>
                  {QUESTION_TYPES.filter((q) => q.value !== 'mixed').map((q) => {
                    const active = questionTypes.includes(q.value);
                    // "Mixed" is exclusive — while it's ticked, every other
                    // row is disabled rather than hidden, so a teacher can
                    // still see what they'd be picking from without it doing
                    // anything until they untick Mixed.
                    const disabled = questionTypes.includes('mixed');
                    return (
                      <Pressable
                        key={q.value}
                        onPress={() => toggleQuestionType(q.value)}
                        disabled={disabled}
                        style={[styles.typeRow, active && { backgroundColor: colors.orangeSoft }, disabled && styles.typeRowDisabled]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active, disabled }}
                        accessibilityLabel={q.label}
                      >
                        <ThemedText style={styles.typeRowLabel}>{q.label}</ThemedText>
                        {active && <Check size={18} color={colors.orange} />}
                      </Pressable>
                    );
                  })}
                  <View style={[styles.typeDivider, { backgroundColor: colors.border }]} />
                  <Pressable
                    onPress={() => toggleQuestionType('mixed')}
                    style={[styles.typeRow, questionTypes.includes('mixed') && { backgroundColor: colors.orangeSoft }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: questionTypes.includes('mixed') }}
                    accessibilityLabel="Mixed"
                  >
                    <ThemedText style={styles.typeRowLabel}>Mixed</ThemedText>
                    {questionTypes.includes('mixed') && <Check size={18} color={colors.orange} />}
                  </Pressable>
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        </View>

        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.label}>
            Number of questions ({QUESTION_COUNT_MIN}–{QUESTION_COUNT_MAX})
          </ThemedText>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => adjustCount(-1)}
              disabled={questionCount <= QUESTION_COUNT_MIN}
              style={[styles.stepperBtn, { borderColor: colors.border }, questionCount <= QUESTION_COUNT_MIN && styles.stepperBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Decrease question count"
            >
              <Minus size={18} color={colors.text} />
            </Pressable>
            <TextInput
              style={[styles.stepperInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface2 }]}
              value={questionCountText}
              onChangeText={handleCountChangeText}
              onBlur={handleCountBlur}
              keyboardType="number-pad"
              maxLength={2}
              selectTextOnFocus
              accessibilityLabel="Number of questions"
            />
            <Pressable
              onPress={() => adjustCount(1)}
              disabled={questionCount >= QUESTION_COUNT_MAX}
              style={[styles.stepperBtn, { borderColor: colors.border }, questionCount >= QUESTION_COUNT_MAX && styles.stepperBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Increase question count"
            >
              <Plus size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <SelectField
          label="Language"
          options={LANGUAGES}
          value={language}
          onChange={setLanguage}
        />

        <TextField
          label="Additional instructions (optional)"
          value={instructions}
          onChangeText={setInstructions}
          maxLength={1000}
          multiline
          numberOfLines={2}
          placeholder="e.g. Focus on real-life examples; suitable for a 20-minute class activity"
        />

        {/* Part of the scrollable form content, not a fixed/sticky footer —
            matches the web's .generator-actions, which is just the last
            child inside <form>, scrolling with the rest of the page
            (client/src/pages/GeneratorPage.tsx). The user scrolls down
            through the form to reach it, same as on web. */}
        <View style={styles.actions}>
          <Button
            title={generating ? 'Generating…' : 'Generate'}
            onPress={handleGenerate}
            loading={generating}
            disabled={generating || !topic.trim() || questionTypes.length === 0}
          />
          {!generating && (
            <View style={styles.generateHint}>
              <Sparkles size={13} color={colors.textMuted} />
              <ThemedText variant="muted" style={styles.generateHintText}>
                Opens a review screen where you can edit every question before saving.
              </ThemedText>
            </View>
          )}
        </View>

        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: colors.semantic.danger.bg }]} accessibilityRole="alert">
            <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600' },
  typeFieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  typeFieldValue: { fontSize: 16, flex: 1 },
  typeOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  typeSheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '70%',
  },
  typeHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  typeSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  typeSheetTitle: { fontSize: 17, fontWeight: '700' },
  typeList: { flexGrow: 0 },
  typeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md, minHeight: 48, borderRadius: radius.sm, paddingHorizontal: spacing.sm,
  },
  typeRowDisabled: { opacity: 0.4 },
  typeRowLabel: { fontSize: 15 },
  typeDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperBtn: {
    width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperInput: {
    fontSize: 18, fontWeight: '700', minWidth: 52, height: 44, textAlign: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm,
  },
  errorBanner: { borderRadius: 10, padding: spacing.sm },
  actions: { gap: spacing.sm },
  generateHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  generateHintText: { fontSize: 12, flex: 1 },
});
