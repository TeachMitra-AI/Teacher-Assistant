// Native port of client/src/pages/ResourceWorkspace.tsx (docs/mobile-app-plan.md
// §26 Phase 5) — edit a saved resource's fields/content, the exam-paper
// letterhead (assessments only), AI Assist, and export/share (replacing
// window.print(), §19). Full JSX rewrite (desktop toolbar/tabs layout ->
// a scrollable form); the request/dirty-check/AI-assist logic matches the
// web workspace.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Save, Share2, Pencil, Eye } from 'lucide-react-native';
import type { LibraryStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { ChipPicker } from '../../components/ChipPicker';
import { SuggestionChips } from '../../components/SuggestionChips';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { useAuth } from '../../auth/AuthContext';
import { getResource, updateResource, runAiAction, type AiActionId } from '../../api/resources';
import { ApiError } from '../../api/client';
import { RESOURCE_TYPES, RESOURCE_TYPE_META, GRADES, SUBJECTS, LANGUAGES } from '../../config';
import { buildInitialExamMeta, mergeExamMeta, parseExamMeta } from '../../lib/examMeta';
import { stripAssessmentPreamble } from '../../lib/assessment';
import { buildResourcePdfHtml, type PrintMode } from '../../lib/buildResourcePdfHtml';
import { exportAndSharePdf, SharingUnavailableError } from '../../lib/exportPdf';
import { MarkdownText } from '../coach/MarkdownText';
import { ExamHeaderView } from './ExamHeaderView';
import { ExamHeaderEditor } from './ExamHeaderEditor';
import { AiAssistSection } from './AiAssistSection';
import { SuggestionModal } from './SuggestionModal';
import type { ExamPaperMeta, LibraryResource, ResourceType } from '../../types';

interface FormState {
  title: string;
  type: ResourceType;
  grade: string;
  subject: string;
  language: string;
  content: string;
}

function toForm(r: LibraryResource): FormState {
  return {
    title: r.title,
    type: r.type,
    grade: r.grade ?? '',
    subject: r.subject ?? '',
    language: r.language || 'en',
    content: r.content ?? '',
  };
}

type Props = NativeStackScreenProps<LibraryStackParamList, 'ResourceEdit'>;

export function ResourceEditScreen({ route, navigation }: Props) {
  const { resourceId } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();

  const [resource, setResource] = useState<LibraryResource | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [examMeta, setExamMeta] = useState<ExamPaperMeta>({});
  const [examMetaBaseline, setExamMetaBaseline] = useState<ExamPaperMeta>({});

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  const [aiBusy, setAiBusy] = useState<AiActionId | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Standard fetch-on-mount pattern (setState synchronously here just
    // resets loading/error before the async fetch starts), not the
    // synchronous-setState anti-pattern this rule targets — see
    // AuthContext.tsx's identical, already-documented case (Phase 3).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    getResource(resourceId)
      .then((r) => {
        if (cancelled) return;
        setResource(r);
        const f = toForm(r);
        setForm(f);
        setBaseline(f);
        const saved = parseExamMeta(r.structured);
        const initial = Object.keys(saved).length > 0
          ? saved
          : user
            ? buildInitialExamMeta(user, user.preferences?.examPaperDefaults)
            : {};
        setExamMeta(initial);
        setExamMetaBaseline(initial);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? 'This resource no longer exists.' : 'Could not load this resource.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on a different resourceId, matching ResourceWorkspace.tsx's own userRef pattern
  }, [resourceId]);

  const dirty = useMemo(
    () =>
      (!!form && !!baseline && (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== baseline[k])) ||
      JSON.stringify(examMeta) !== JSON.stringify(examMetaBaseline),
    [form, baseline, examMeta, examMetaBaseline]
  );

  // Guard back navigation (header back, swipe-back, hardware back) with an
  // unsaved-changes confirmation — the native analogue of the web's
  // window.confirm-based leave()/beforeunload guards.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirty) return;
      e.preventDefault();
      Alert.alert('Unsaved changes', 'Leave without saving?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsub;
  }, [navigation, dirty]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }, []);

  const isAssessment = form?.type === 'assessment';

  const handleSave = useCallback(async () => {
    if (!form || !baseline || !resource || saving) return;
    const cleanTitle = form.title.trim();
    if (!cleanTitle) {
      Alert.alert('Title required', 'Please enter a title.');
      return;
    }
    const patch: Record<string, string> = {};
    if (cleanTitle !== baseline.title) patch.title = cleanTitle;
    if (form.type !== baseline.type) patch.type = form.type;
    if (form.grade !== baseline.grade) patch.grade = form.grade.trim();
    if (form.subject !== baseline.subject) patch.subject = form.subject.trim();
    if (form.language !== baseline.language) patch.language = form.language;
    if (form.content !== baseline.content) patch.content = form.content;
    if (JSON.stringify(examMeta) !== JSON.stringify(examMetaBaseline)) {
      patch.structured = mergeExamMeta(resource.structured, examMeta);
    }
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    try {
      const updated = await updateResource(resource.id, patch);
      setResource(updated);
      const f = toForm(updated);
      setForm(f);
      setBaseline(f);
      if ('structured' in patch) setExamMetaBaseline(examMeta);
    } catch (err) {
      Alert.alert('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [form, baseline, resource, saving, examMeta, examMetaBaseline]);

  async function runAction(action: AiActionId, targetGrade?: string) {
    if (!resource || aiBusy) return;
    setAiBusy(action);
    try {
      const result = await runAiAction(resource.id, action, { targetGrade });
      setSuggestion(result.suggestion);
    } catch (err) {
      Alert.alert('AI action failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setAiBusy(null);
    }
  }

  function applySuggestion() {
    if (suggestion == null) return;
    setField('content', suggestion);
    setSuggestion(null);
    setTab('edit');
  }

  const exportAndShare = useCallback(async (mode: PrintMode) => {
    if (!form || !resource) return;
    setExporting(true);
    try {
      const html = buildResourcePdfHtml({
        title: form.title,
        type: form.type,
        grade: form.grade,
        subject: form.subject,
        language: form.language,
        content: form.content,
        updatedAt: resource.updatedAt,
        examMeta: isAssessment ? examMeta : undefined,
        printMode: mode,
      });
      await exportAndSharePdf(html, form.title);
    } catch (err) {
      if (err instanceof SharingUnavailableError) {
        Alert.alert('Sharing unavailable', 'This device cannot share files.');
      } else {
        Alert.alert('Could not export', 'Please try again.');
      }
    } finally {
      setExporting(false);
    }
  }, [form, resource, isAssessment, examMeta]);

  const handleExportPress = useCallback(() => {
    if (!isAssessment) {
      void exportAndShare('full');
      return;
    }
    Alert.alert('Export as…', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Student version', onPress: () => void exportAndShare('student') },
      { text: 'Teacher version', onPress: () => void exportAndShare('teacher') },
    ]);
  }, [isAssessment, exportAndShare]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleExportPress}
            disabled={exporting || loading || !!error}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Print or export"
            testID="workspace-export"
          >
            {exporting ? <ActivityIndicator size="small" color={colors.text} /> : <Share2 size={18} color={colors.text} />}
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving || loading || !dirty}
            style={[styles.headerBtn, (saving || loading || !dirty) && styles.headerBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Save changes"
            testID="workspace-save"
          >
            {saving ? <ActivityIndicator size="small" color={colors.orange} /> : <Save size={18} color={dirty ? colors.orange : colors.textMuted} />}
          </Pressable>
        </View>
      ),
    });
  }, [navigation, saving, loading, error, dirty, exporting, handleSave, handleExportPress, colors]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.orange} />
      </View>
    );
  }

  if (error || !form || !resource) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ThemedText style={{ color: '#e5484d' }}>{error || 'Could not load this resource.'}</ThemedText>
      </View>
    );
  }

  const previewContent = isAssessment ? stripAssessmentPreamble(form.content) : form.content;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextField
          label="Title"
          value={form.title}
          onChangeText={(t) => setField('title', t)}
          maxLength={200}
          placeholder="Untitled resource"
          testID="workspace-title"
        />

        <ChipPicker
          label="Type"
          options={RESOURCE_TYPES.map((t) => ({ value: t, label: RESOURCE_TYPE_META[t].label, icon: RESOURCE_TYPE_META[t].icon }))}
          value={form.type}
          onChange={(v) => setField('type', v as ResourceType)}
        />

        <View style={styles.field}>
          <TextField label="Grade" value={form.grade} onChangeText={(t) => setField('grade', t)} placeholder="e.g. Class 3-5" maxLength={80} />
          <SuggestionChips options={GRADES} onSelect={(v) => setField('grade', v)} />
        </View>

        <View style={styles.field}>
          <TextField label="Subject" value={form.subject} onChangeText={(t) => setField('subject', t)} placeholder="e.g. Science" maxLength={80} />
          <SuggestionChips options={SUBJECTS} onSelect={(v) => setField('subject', v)} />
        </View>

        <ChipPicker
          label="Language"
          options={LANGUAGES}
          value={form.language}
          onChange={(v) => setField('language', v)}
        />

        {isAssessment && <ExamHeaderEditor value={examMeta} onChange={setExamMeta} />}

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

        {tab === 'edit' ? (
          <TextInput
            style={[styles.editor, { color: colors.text, backgroundColor: colors.surface2, borderColor: colors.border }]}
            value={form.content}
            onChangeText={(t) => setField('content', t)}
            placeholder="Write your content here…"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Resource content"
            testID="workspace-content"
          />
        ) : (
          <View style={[styles.preview, { borderColor: colors.border }]}>
            {isAssessment && (
              <ExamHeaderView meta={examMeta} fallbackTitle={form.title} subject={form.subject} grade={form.grade} />
            )}
            <MarkdownText text={previewContent || '_Nothing to preview yet._'} />
          </View>
        )}

        <AiAssistSection isAssessment={isAssessment} busy={aiBusy} onRun={runAction} />
      </ScrollView>

      <SuggestionModal suggestion={suggestion} onApply={applySuggestion} onCancel={() => setSuggestion(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  tabs: { flexDirection: 'row', gap: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  editor: {
    minHeight: 260,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    lineHeight: 21,
  },
  preview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md },
  headerActions: { flexDirection: 'row', gap: spacing.xs },
  headerBtn: { padding: spacing.sm },
  headerBtnDisabled: { opacity: 0.4 },
});
