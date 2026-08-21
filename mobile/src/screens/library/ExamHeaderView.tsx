// Native render of client/src/components/ExamHeader.tsx's exam-paper
// letterhead, for on-screen preview (ResourceViewScreen, ResourceEditScreen's
// Preview tab). The PDF export uses its own HTML build
// (lib/buildResourcePdfHtml.ts) since expo-print renders a standalone
// document, not this component.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import type { ExamPaperMeta } from '../../types';

export function ExamHeaderView({
  meta, fallbackTitle, subject, grade,
}: {
  meta: ExamPaperMeta;
  fallbackTitle: string;
  subject?: string;
  grade?: string;
}) {
  const { colors } = useTheme();
  const blank = '____________';

  return (
    <View style={[styles.container, { borderBottomColor: colors.text }]}>
      {!!meta.schoolName && (
        <ThemedText style={styles.school}>{meta.schoolName}</ThemedText>
      )}
      <ThemedText style={styles.name}>{meta.examName || fallbackTitle}</ThemedText>

      <View style={styles.rows}>
        <View style={styles.row}>
          <ThemedText style={styles.rowText}>Class: {grade || blank}</ThemedText>
          <ThemedText style={styles.rowText}>Subject: {subject || blank}</ThemedText>
        </View>
        {(meta.showDate || meta.teacherName) && (
          <View style={styles.row}>
            {meta.showDate && <ThemedText style={styles.rowText}>Date: {meta.date || blank}</ThemedText>}
            {meta.teacherName && <ThemedText style={styles.rowText}>Teacher: {meta.teacherName}</ThemedText>}
          </View>
        )}
        <View style={styles.row}>
          {meta.showTime && <ThemedText style={styles.rowText}>Time: {meta.time || blank}</ThemedText>}
          <ThemedText style={styles.rowText}>Maximum Marks: {meta.maxMarks || blank}</ThemedText>
        </View>
        <View style={[styles.row, styles.studentRow, { borderTopColor: colors.border }]}>
          <ThemedText variant="muted" style={styles.rowText}>Name: ________________________</ThemedText>
          <ThemedText variant="muted" style={styles.rowText}>Roll No.: __________</ThemedText>
        </View>
      </View>

      {!!meta.customInstructions && (
        <ThemedText variant="muted" style={styles.instructions}>
          General Instructions: {meta.customInstructions}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: 2, paddingBottom: spacing.md, marginBottom: spacing.md, alignItems: 'center' },
  school: { fontSize: 17, fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  rows: { width: '100%', marginTop: spacing.sm, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  rowText: { fontSize: 13 },
  studentRow: { marginTop: 4, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  instructions: { width: '100%', fontSize: 13, marginTop: spacing.sm, textAlign: 'left' },
});
