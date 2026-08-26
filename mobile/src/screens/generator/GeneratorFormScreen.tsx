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
  View, ScrollView, KeyboardAvoidingView, Platform, Pressable, StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Sparkles, Minus, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GeneratorStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { ChipPicker } from '../../components/ChipPicker';
import { SuggestionChips } from '../../components/SuggestionChips';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { generateAssessment, type GenerateAssessmentInput, type AssessmentFormat, type Difficulty, type QuestionType } from '../../api/resources';
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
  const [questionType, setQuestionType] = useState<QuestionType>('mcq');
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNT_DEFAULT);
  const [language, setLanguage] = useState('en');
  const [instructions, setInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  function adjustCount(delta: number) {
    setQuestionCount((n) => Math.min(QUESTION_COUNT_MAX, Math.max(QUESTION_COUNT_MIN, n + delta)));
  }

  async function handleGenerate() {
    if (generating || !topic.trim()) return;
    setGenerating(true);
    setError('');
    const input: GenerateAssessmentInput = {
      format,
      grade: grade.trim() || undefined,
      subject: subject.trim() || undefined,
      topic: topic.trim(),
      difficulty,
      questionType,
      questionCount,
      language,
      instructions: instructions.trim() || undefined,
    };
    try {
      const result = await generateAssessment(input);
      navigation.navigate('GeneratorResult', {
        format, grade: grade.trim(), subject: subject.trim(), topic: topic.trim(),
        difficulty, questionType, questionCount, language,
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

        <View style={styles.field}>
          <TextField label="Grade" value={grade} onChangeText={setGrade} placeholder="e.g. Class 3-5" maxLength={80} />
          <SuggestionChips options={GRADES} onSelect={setGrade} />
        </View>

        <View style={styles.field}>
          <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Mathematics" maxLength={80} />
          <SuggestionChips options={SUBJECTS} onSelect={setSubject} />
        </View>

        <ChipPicker
          label="Difficulty"
          options={DIFFICULTIES}
          value={difficulty}
          onChange={(v) => setDifficulty(v as Difficulty)}
        />

        <ChipPicker
          label="Question type"
          options={QUESTION_TYPES}
          value={questionType}
          onChange={(v) => setQuestionType(v as QuestionType)}
        />

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
            <ThemedText style={styles.stepperValue}>{questionCount}</ThemedText>
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

        <ChipPicker
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

        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: colors.semantic.danger.bg }]} accessibilityRole="alert">
            <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky bottom action bar, matching the web's own .classroom-save-bar
          precedent (UI_REFINED.md §13) — the primary action stays
          thumb-reachable instead of sitting below a 9-field scroll. */}
      <View
        style={[
          styles.actionBar,
          { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <Button
          title={generating ? 'Generating…' : 'Generate'}
          onPress={handleGenerate}
          loading={generating}
          disabled={generating || !topic.trim()}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperBtn: {
    width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperValue: { fontSize: 18, fontWeight: '700', minWidth: 32, textAlign: 'center' },
  errorBanner: { borderRadius: 10, padding: spacing.sm },
  actionBar: {
    borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm,
  },
  generateHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  generateHintText: { fontSize: 12, flex: 1 },
});
