// Shared Add/Edit sheet for Students (Phase 8 Step 3) — one form, two modes,
// matching web StudentRoster.tsx's identical name/rollNumber field pair.
// Modal-over-Pressable-backdrop convention per DailyHighlightCard.tsx /
// ProfileMenu.tsx (this app's established "native-idiomatic sheet" pattern —
// no bottom-sheet dependency added for one two-field form).
import React, { useState } from 'react';
import { View, Pressable, Modal, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';

const MAX_NAME = 200;
const MAX_ROLL_NUMBER = 60;

interface StudentFormModalProps {
  visible: boolean;
  title: string;
  submitLabel: string;
  initialName?: string;
  initialRollNumber?: string;
  submitting: boolean;
  error: string;
  onSubmit: (name: string, rollNumber: string) => void;
  onClose: () => void;
}

export function StudentFormModal({
  visible,
  title,
  submitLabel,
  initialName = '',
  initialRollNumber = '',
  submitting,
  error,
  onSubmit,
  onClose,
}: StudentFormModalProps) {
  const { colors } = useTheme();
  // Plain useState initializers, not an effect+setState reset — the caller
  // remounts this component (via a `key` keyed on which student is being
  // edited, see StudentsScreen.tsx) whenever a different target opens, so
  // React itself resets the form state; no synchronization-on-prop-change
  // logic is needed here.
  const [name, setName] = useState(initialName);
  const [rollNumber, setRollNumber] = useState(initialRollNumber);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={submitting ? undefined : onClose} accessibilityLabel="Close">
        <Pressable onPress={(e) => e.stopPropagation()} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ThemedText style={styles.title}>{title}</ThemedText>

          <TextField
            label="Student name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Asha Verma"
            maxLength={MAX_NAME}
            autoFocus
            testID="student-form-name"
          />
          <TextField
            label="Roll number (optional)"
            value={rollNumber}
            onChangeText={setRollNumber}
            placeholder="e.g. 12"
            maxLength={MAX_ROLL_NUMBER}
            testID="student-form-roll-number"
          />

          {!!error && <ThemedText style={[styles.error, { color: colors.semantic.danger.text }]}>{error}</ThemedText>}

          <View style={styles.actions}>
            <Button title="Cancel" variant="text" onPress={onClose} disabled={submitting} />
            <Button
              title={submitLabel}
              onPress={() => onSubmit(name.trim(), rollNumber.trim())}
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
