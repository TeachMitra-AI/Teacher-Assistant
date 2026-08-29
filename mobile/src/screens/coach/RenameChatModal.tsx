// Rename dialog for one History sidebar row — ported behavior from the
// web Sidebar's inline rename input (client/src/components/Sidebar.tsx's
// renamingId/renameDraft), but as a centered Modal dialog instead of an
// inline text input swapped into the row: this app has no established
// inline-edit-a-list-row pattern, and Modal-over-Pressable-backdrop (per
// StudentFormModal.tsx) is the existing convention for a short one-field
// form. `title` only overrides the sidebar label — see useHistoryOverrides.ts.
import React, { useState } from 'react';
import { View, Pressable, Modal, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';

const MAX_TITLE_LENGTH = 200;

interface RenameChatModalProps {
  visible: boolean;
  initialTitle: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}

export function RenameChatModal({ visible, initialTitle, onSubmit, onClose }: RenameChatModalProps) {
  const { colors } = useTheme();
  // Plain useState initializer, not an effect+setState reset — the caller
  // remounts this component (via a `key` keyed on which item is being
  // renamed, see HistorySidebar.tsx) whenever a different target opens.
  const [title, setTitle] = useState(initialTitle);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit(trimmed.slice(0, MAX_TITLE_LENGTH));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close">
        <Pressable onPress={(e) => e.stopPropagation()} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ThemedText style={styles.title}>Rename chat</ThemedText>
          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            maxLength={MAX_TITLE_LENGTH}
            autoFocus
            selectTextOnFocus
            testID="rename-chat-input"
          />
          <View style={styles.actions}>
            <Button title="Cancel" variant="text" onPress={onClose} />
            <Button title="Save" onPress={submit} disabled={!title.trim()} />
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
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
});
