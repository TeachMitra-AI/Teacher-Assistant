// Native port of client/src/pages/ResourceView.tsx (docs/mobile-app-plan.md
// §26 Phase 5) — view + delete + the export/share flow that replaces
// ResourceWorkspace.tsx's window.print() (§19). Editing lives on its own
// screen (ResourceEditScreen), matching the web's separate /library/:id/edit
// route.
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Trash2, Share2 } from 'lucide-react-native';
import type { LibraryStackParamList } from '../../navigation/types';
import { ThemedText } from '../../components/ThemedText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { getResource, deleteResource } from '../../api/resources';
import { ApiError } from '../../api/client';
import { RESOURCE_TYPE_META } from '../../config';
import { MarkdownText } from '../coach/MarkdownText';
import { ExamHeaderView } from './ExamHeaderView';
import { parseExamMeta } from '../../lib/examMeta';
import { stripAssessmentPreamble } from '../../lib/assessment';
import { buildResourcePdfHtml, type PrintMode } from '../../lib/buildResourcePdfHtml';
import { exportAndSharePdf, SharingUnavailableError } from '../../lib/exportPdf';
import type { LibraryResource } from '../../types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type Props = NativeStackScreenProps<LibraryStackParamList, 'ResourceView'>;

export function ResourceViewScreen({ route, navigation }: Props) {
  const { resourceId } = route.params;
  const { colors } = useTheme();

  const [resource, setResource] = useState<LibraryResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await getResource(resourceId);
      setResource(r);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'This resource no longer exists.' : 'Could not load this resource.');
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    // Standard fetch-on-mount pattern, not the synchronous-setState
    // anti-pattern this rule targets — see AuthContext.tsx's identical,
    // already-documented case (Phase 3).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Reload after returning from Edit (a saved change) — the stack pop from
  // ResourceEdit back to ResourceView doesn't remount this screen.
  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  function handleDelete() {
    if (!resource) return;
    Alert.alert('Delete resource?', `Delete "${resource.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteResource(resource.id);
            navigation.goBack();
          } catch (err) {
            Alert.alert('Could not delete', err instanceof ApiError ? err.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  async function exportAndShare(mode: PrintMode) {
    if (!resource) return;
    setExporting(true);
    try {
      const html = buildResourcePdfHtml({
        title: resource.title,
        type: resource.type,
        grade: resource.grade ?? undefined,
        subject: resource.subject ?? undefined,
        language: resource.language,
        content: resource.content,
        updatedAt: resource.updatedAt,
        examMeta: resource.type === 'assessment' ? parseExamMeta(resource.structured) : undefined,
        printMode: mode,
      });
      await exportAndSharePdf(html, resource.title);
    } catch (err) {
      if (err instanceof SharingUnavailableError) {
        Alert.alert('Sharing unavailable', 'This device cannot share files.');
      } else {
        Alert.alert('Could not export', 'Please try again.');
      }
    } finally {
      setExporting(false);
    }
  }

  function handleExportPress() {
    if (!resource) return;
    if (resource.type === 'assessment') {
      Alert.alert('Export as…', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Student version (no answer key)', onPress: () => exportAndShare('student') },
        { text: 'Teacher version (with answer key)', onPress: () => exportAndShare('teacher') },
      ]);
    } else {
      void exportAndShare('full');
    }
  }

  const TypeIcon = resource ? RESOURCE_TYPE_META[resource.type].icon : null;
  const isAssessment = resource?.type === 'assessment';
  const examMeta = resource && isAssessment ? parseExamMeta(resource.structured) : {};
  const bodyContent = resource ? (isAssessment ? stripAssessmentPreamble(resource.content || '') : resource.content || '') : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: '#e5484d' }}>{error}</ThemedText>
          <Button title="Back to Library" onPress={() => navigation.goBack()} style={styles.backBtn} />
        </View>
      )}

      {!loading && !error && resource && (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.header}>
              {TypeIcon && (
                <View style={styles.typeRow}>
                  <TypeIcon size={14} color={colors.orange} />
                  <ThemedText variant="muted" style={styles.typeLabel}>{RESOURCE_TYPE_META[resource.type].label}</ThemedText>
                </View>
              )}
              <ThemedText variant="title" style={styles.title}>{resource.title}</ThemedText>
              <ThemedText variant="muted">
                {[resource.grade, resource.subject].filter(Boolean).join(' · ')}
                {(resource.grade || resource.subject) ? ' • ' : ''}
                Updated {formatDate(resource.updatedAt)}
              </ThemedText>
            </View>

            {isAssessment && (
              <ExamHeaderView meta={examMeta} fallbackTitle={resource.title} subject={resource.subject ?? undefined} grade={resource.grade ?? undefined} />
            )}

            <MarkdownText text={bodyContent || '_Nothing to show yet._'} />
          </ScrollView>

          <View style={[styles.toolbar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <Pressable
              onPress={handleExportPress}
              disabled={exporting}
              style={styles.toolbarAction}
              accessibilityRole="button"
              accessibilityLabel="Print or export"
            >
              {exporting ? <ActivityIndicator size="small" color={colors.text} /> : <Share2 size={18} color={colors.text} />}
              <ThemedText style={styles.toolbarLabel}>{exporting ? 'Exporting…' : 'Share / Export'}</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleDelete}
              style={styles.toolbarAction}
              accessibilityRole="button"
              accessibilityLabel="Delete this resource"
            >
              <Trash2 size={18} color={colors.text} />
              <ThemedText style={styles.toolbarLabel}>Delete</ThemedText>
            </Pressable>
            <Button
              title="Edit"
              onPress={() => navigation.navigate('ResourceEdit', { resourceId: resource.id })}
              style={styles.editBtn}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  backBtn: { marginTop: spacing.sm },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { gap: 4, marginBottom: spacing.sm },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeLabel: { fontSize: 12, fontWeight: '600' },
  title: { fontSize: 22 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  toolbarAction: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm },
  toolbarLabel: { fontSize: 13, fontWeight: '600' },
  editBtn: { marginLeft: 'auto', paddingHorizontal: spacing.lg },
});
