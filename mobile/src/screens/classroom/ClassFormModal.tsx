// Add-class sheet (Phase 8 Step 4) — Modal-over-Pressable-backdrop
// convention per DailyHighlightCard.tsx / StudentFormModal.tsx. Create-only
// (no rename in this step's scope, unlike Students' shared add/edit form) —
// fields/limits mirror the server's createClassSchema exactly
// (server/src/routes/classroom.js): name required (<=200 chars), grade/
// section optional (<=60 chars each). feeAmount is deliberately not exposed
// here — it belongs to the Fees feature surface (Phase 10), out of scope.
import React, { useState } from 'react';
import { View, Pressable, Modal, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';

const MAX_NAME = 200;
const MAX_META = 60;

interface ClassFormModalProps {
  visible: boolean;
  submitting: boolean;
  error: string;
  onSubmit: (name: string, grade: string, section: string) => void;
  onClose: () => void;
}

export function ClassFormModal({ visible, submitting, error, onSubmit, onClose }: ClassFormModalProps) {
  const { colors } = useTheme();
  // Plain useState, no reset effect — this form has exactly one mode (add),
  // so there is nothing to re-key/remount between opens the way
  // StudentFormModal's add/edit dual-mode sheet needs to. A failed submit
  // deliberately leaves these untouched, so entered text survives an API
  // error (Phase 8 Step 4's own requirement).
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');

  function handleClose() {
    if (submitting) return;
    setName('');
    setGrade('');
    setSection('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose} accessibilityLabel="Close">
        <Pressable onPress={(e) => e.stopPropagation()} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ThemedText style={styles.title}>Add class</ThemedText>

          <TextField
            label="Class name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Class 5-A"
            maxLength={MAX_NAME}
            autoFocus
            testID="class-form-name"
          />
          <TextField
            label="Grade (optional)"
            value={grade}
            onChangeText={setGrade}
            placeholder="e.g. Class 5"
            maxLength={MAX_META}
            testID="class-form-grade"
          />
          <TextField
            label="Section (optional)"
            value={section}
            onChangeText={setSection}
            placeholder="e.g. A"
            maxLength={MAX_META}
            testID="class-form-section"
          />

          {!!error && <ThemedText style={[styles.error, { color: colors.semantic.danger.text }]}>{error}</ThemedText>}

          <View style={styles.actions}>
            <Button title="Cancel" variant="text" onPress={handleClose} disabled={submitting} />
            <Button
              title="Add"
              onPress={() => onSubmit(name.trim(), grade.trim(), section.trim())}
              loading={submitting}
              disabled={!name.trim()}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  panel: { width: '100%', maxWidth: 440, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 17, fontWeight: '700' },
  error: { fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
});
