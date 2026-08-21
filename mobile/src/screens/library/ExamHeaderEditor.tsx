// Native port of client/src/components/ExamHeaderEditor.tsx — the teacher-
// facing "Paper details" form for the exam-paper letterhead. Fully optional:
// every field left blank just means ExamHeaderView/buildResourcePdfHtml
// omits or blanks that row. Controlled component: the parent
// (ResourceEditScreen) owns the ExamPaperMeta value and persists it into
// Resource.structured.examMeta (lib/examMeta.ts).
import React, { useState } from 'react';
import { View, Switch, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import type { ExamPaperMeta } from '../../types';

export function ExamHeaderEditor({
  value, onChange,
}: {
  value: ExamPaperMeta;
  onChange: (next: ExamPaperMeta) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  function set<K extends keyof ExamPaperMeta>(key: K, v: ExamPaperMeta[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        {open ? <ChevronUp size={15} color={colors.text} /> : <ChevronDown size={15} color={colors.text} />}
        <ThemedText style={styles.toggleLabel}>Paper details</ThemedText>
        <ThemedText variant="muted" style={styles.toggleHint}>School, exam name, date, marks</ThemedText>
      </Pressable>

      {open && (
        <View style={styles.grid}>
          <TextField
            label="School name"
            value={value.schoolName ?? ''}
            maxLength={120}
            onChangeText={(t) => set('schoolName', t)}
            placeholder="e.g. Govt Middle School, Rampur"
          />
          <TextField
            label="Exam / assessment name"
            value={value.examName ?? ''}
            maxLength={120}
            onChangeText={(t) => set('examName', t)}
            placeholder="e.g. Unit Test 2 (defaults to the title)"
          />
          <TextField
            label="Teacher name"
            value={value.teacherName ?? ''}
            maxLength={80}
            onChangeText={(t) => set('teacherName', t)}
            placeholder="Optional"
          />

          <View style={styles.switchRow}>
            <Switch value={value.showDate ?? false} onValueChange={(v) => set('showDate', v)} />
            <View style={styles.switchField}>
              <TextField
                label="Date"
                value={value.date ?? ''}
                editable={!!value.showDate}
                maxLength={40}
                onChangeText={(t) => set('date', t)}
                placeholder="e.g. 12 August 2026 (blank prints a line)"
              />
            </View>
          </View>

          <View style={styles.switchRow}>
            <Switch value={value.showTime ?? false} onValueChange={(v) => set('showTime', v)} />
            <View style={styles.switchField}>
              <TextField
                label="Time / duration"
                value={value.time ?? ''}
                editable={!!value.showTime}
                maxLength={40}
                onChangeText={(t) => set('time', t)}
                placeholder="e.g. 45 minutes"
              />
            </View>
          </View>

          <TextField
            label="Maximum marks"
            value={value.maxMarks ?? ''}
            maxLength={20}
            onChangeText={(t) => set('maxMarks', t)}
            placeholder="e.g. 20"
          />
          <TextField
            label="Custom instructions (optional)"
            value={value.customInstructions ?? ''}
            maxLength={500}
            multiline
            numberOfLines={2}
            onChangeText={(t) => set('customInstructions', t)}
            placeholder="e.g. Use of calculator is not allowed."
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  toggleLabel: { fontWeight: '600' },
  toggleHint: { fontSize: 12 },
  grid: { gap: spacing.sm, paddingBottom: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchField: { flex: 1 },
});
