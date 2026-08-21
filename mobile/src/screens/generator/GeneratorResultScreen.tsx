// Native Generator result/edit/save screen (Generator v2 Stage 3 —
// docs/generator-v2-plan.md, docs/mobile-app-plan.md Phase 6). Reached from
// GeneratorFormScreen with the generate response in route params. Mirrors
// client/src/pages/GeneratorPage.tsx's result section: structured mode when
// the response has a parseable structured document (gated by
// STRUCTURED_QUESTIONS_ENABLED, exactly like web), legacy single-textarea
// mode otherwise — this screen NEVER falls back to the markdown textarea
// when a structured document is available, per the Stage 3 spec. Reorder
// uses QuestionListEditor's Move Up/Down (no new native dependency, matching
// the approved web pattern).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Save, Pencil, Eye } from 'lucide-react-native';
import type { GeneratorStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { QuestionListEditor } from '../../components/QuestionListEditor';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { useAuth } from '../../auth/AuthContext';
import { createResource } from '../../api/resources';
import type { AssessmentFormat, Question } from '../../api/resources';
import { ApiError } from '../../api/client';
import { STRUCTURED_QUESTIONS_ENABLED } from '../../config';
import { buildInitialExamMeta } from '../../lib/examMeta';
import { stripAssessmentPreamble } from '../../lib/assessment';
import { parseStructuredDocument, buildStructuredPayload, validateQuestions } from '../../lib/structuredQuestions';
import { ExamHeaderView } from '../library/ExamHeaderView';
import { ExamHeaderEditor } from '../library/ExamHeaderEditor';
import { MarkdownText } from '../coach/MarkdownText';
import type { ExamPaperMeta } from '../../types';

const FORMAT_LABELS: Record<AssessmentFormat, string> = {
  quiz: 'Quiz', worksheet: 'Worksheet', exit_ticket: 'Exit Ticket', homework: 'Homework',
};

function defaultTitle(format: AssessmentFormat, topic: string, grade: string): string {
  const kind = FORMAT_LABELS[format];
  const t = topic.trim() || 'Untitled';
  const g = grade.trim() ? ` (${grade.trim()})` : '';
  return `${kind}: ${t}${g}`.slice(0, 200);
}

type Props = NativeStackScreenProps<GeneratorStackParamList, 'GeneratorResult'>;

export function GeneratorResultScreen({ route, navigation }: Props) {
  const { format, grade, subject, topic, difficulty, questionType, questionCount, language, content: initialContent, structured } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();

  const [title, setTitle] = useState(() => defaultTitle(format, topic, grade));
  const [content, setContent] = useState(initialContent);
  const [tab, setTab] = useState<'preview' | 'edit'>('preview');
  const [saving, setSaving] = useState(false);

  const parsedDoc = STRUCTURED_QUESTIONS_ENABLED ? parseStructuredDocument(structured) : null;
  const [structuredQuestions, setStructuredQuestions] = useState<Question[] | null>(parsedDoc ? parsedDoc.questions : null);
  const [docInstructions, setDocInstructions] = useState(parsedDoc ? parsedDoc.instructions : '');
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});

  const [examMeta, setExamMeta] = useState<ExamPaperMeta>(
    () => (user ? buildInitialExamMeta(user, user.preferences?.examPaperDefaults) : {})
  );

  // Nothing here is persisted until Save succeeds — a generated result took a
  // real AI call to produce, so guard every back-navigation attempt, not just
  // ones after a hand edit (unlike ResourceEditScreen's `dirty`-gated guard,
  // which only warns on genuine edits to an already-saved resource).
  const savedRef = useRef(false);
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (savedRef.current) return;
      e.preventDefault();
      Alert.alert('Discard this result?', 'Leaving now will lose the generated questions.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsub;
  }, [navigation]);

  const isAssessment = true; // Generator always creates an 'assessment' resource.

  async function handleSave() {
    if (saving) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      Alert.alert('Title required', 'Please enter a title.');
      return;
    }
    if (structuredQuestions !== null) {
      if (structuredQuestions.length === 0) {
        Alert.alert('Add a question', 'Add at least one question before saving.');
        return;
      }
      const errors = validateQuestions(structuredQuestions);
      if (Object.keys(errors).length > 0) {
        setQuestionErrors(errors);
        Alert.alert('Fix questions', 'Fix the highlighted questions before saving.');
        return;
      }
    }

    setSaving(true);
    try {
      const structuredPayload = structuredQuestions !== null
        ? buildStructuredPayload({
            instructions: docInstructions,
            questions: structuredQuestions,
            format, difficulty, questionType, questionCount, topic, examMeta,
          })
        : JSON.stringify({ format, difficulty, questionType, questionCount, topic, examMeta });

      const saved = await createResource({
        type: 'assessment',
        title: cleanTitle.slice(0, 200),
        grade: grade || undefined,
        subject: subject || undefined,
        language,
        // Structured mode: the server re-renders `content` itself from
        // structured.questions (docs/generator-v2-plan.md §2c) — omit rather
        // than send a `content` the client never recomputed.
        ...(structuredQuestions !== null ? {} : { content }),
        structured: structuredPayload,
      });
      savedRef.current = true;
      const parent = navigation.getParent();
      if (parent) {
        // Cross-tab navigation: GeneratorStack's screen types have no
        // knowledge of MainTabParamList's other stacks, so the parent tab
        // navigator's `navigate` is called through an escape hatch here —
        // this still resolves and type-checks the destination route/params
        // via MainTabParamList/LibraryStackParamList at the cast boundary.
        (parent.navigate as (name: 'LibraryTab', params: { screen: 'ResourceEdit'; params: { resourceId: string } }) => void)(
          'LibraryTab',
          { screen: 'ResourceEdit', params: { resourceId: saved.id } }
        );
      } else {
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={handleSave}
          disabled={saving || !title.trim()}
          style={[styles.headerBtn, (saving || !title.trim()) && styles.headerBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Save to Library"
          testID="generator-save"
        >
          {saving ? <ActivityIndicator size="small" color={colors.orange} /> : <Save size={18} color={colors.orange} />}
        </Pressable>
      ),
    });
  });

  const previewContent = stripAssessmentPreamble(content);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.noteBanner}>
          <ThemedText variant="muted" style={styles.noteText}>
            Review and edit below, then save. Nothing is saved until you tap the save icon above.
          </ThemedText>
        </View>

        <TextField label="Title" value={title} onChangeText={setTitle} maxLength={200} placeholder="Untitled resource" testID="generator-title" />

        <ExamHeaderEditor value={examMeta} onChange={setExamMeta} />

        <View style={styles.tabs}>
          <Pressable
            onPress={() => setTab('edit')}
            style={[styles.tab, tab === 'edit' && { borderBottomColor: colors.orange }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'edit' }}
          >
            <Pencil size={14} color={tab === 'edit' ? colors.orange : colors.textMuted} />
            <ThemedText style={{ color: tab === 'edit' ? colors.orange : colors.textMuted, fontWeight: '600' }}>Edit</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setTab('preview')}
            style={[styles.tab, tab === 'preview' && { borderBottomColor: colors.orange }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'preview' }}
          >
            <Eye size={14} color={tab === 'preview' ? colors.orange : colors.textMuted} />
            <ThemedText style={{ color: tab === 'preview' ? colors.orange : colors.textMuted, fontWeight: '600' }}>Preview</ThemedText>
          </Pressable>
        </View>

        {structuredQuestions !== null ? (
          tab === 'edit' ? (
            <>
              <TextField
                label="Instructions for students"
                value={docInstructions}
                onChangeText={setDocInstructions}
                maxLength={500}
                placeholder="e.g. Answer all questions carefully."
              />
              <QuestionListEditor
                questions={structuredQuestions}
                editable
                errors={questionErrors}
                onChange={(next) => {
                  setStructuredQuestions(next);
                  setQuestionErrors({});
                }}
              />
            </>
          ) : (
            <View style={[styles.preview, { borderColor: colors.border }]}>
              <ExamHeaderView meta={examMeta} fallbackTitle={title} subject={subject} grade={grade} />
              {!!docInstructions && <ThemedText variant="muted" style={styles.instructions}>{docInstructions}</ThemedText>}
              <QuestionListEditor questions={structuredQuestions} editable={false} />
            </View>
          )
        ) : tab === 'edit' ? (
          <TextInput
            style={[styles.editor, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
            value={content}
            onChangeText={setContent}
            placeholder="Generated content"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Generated content"
            testID="generator-content"
          />
        ) : (
          <View style={[styles.preview, { borderColor: colors.border }]}>
            {isAssessment && <ExamHeaderView meta={examMeta} fallbackTitle={title} subject={subject} grade={grade} />}
            <MarkdownText text={previewContent || '_Nothing to preview yet._'} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  noteBanner: { paddingBottom: 2 },
  noteText: { fontSize: 12 },
  tabs: { flexDirection: 'row', gap: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  editor: {
    minHeight: 260, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm,
    padding: spacing.md, fontSize: 15, lineHeight: 21,
  },
  preview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md },
  instructions: { fontSize: 13, marginBottom: spacing.sm },
  headerBtn: { padding: spacing.sm },
  headerBtnDisabled: { opacity: 0.4 },
});
