// Native port of client/src/components/AttachmentPreviewModal.tsx — opened by
// tapping a staged file's thumbnail in the Composer, so a teacher can check
// they photographed the right page before sending. Images render full-screen;
// a PDF has no embedded viewer here (no PDF-rendering library is installed —
// deliberately not added just for this preview), so it falls back to the same
// "can't preview" message the web version shows when the browser has no PDF
// viewer, rather than a blank panel that reads as a failed upload.
import React from 'react';
import { View, Pressable, Image, Modal, StyleSheet } from 'react-native';
import { X, FileText } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import type { AttachmentTrayItem } from './AttachmentTray';

interface AttachmentPreviewModalProps {
  attachment: AttachmentTrayItem;
  onClose: () => void;
}

export function AttachmentPreviewModal({ attachment, onClose }: AttachmentPreviewModalProps) {
  const { colors } = useTheme();
  const isImage = attachment.kind === 'image' && attachment.previewUri;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close preview">
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.head}>
            <ThemedText style={styles.name} numberOfLines={1}>{attachment.name}</ThemedText>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
              hitSlop={8}
              style={[styles.closeBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
            >
              <X size={18} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.body}>
            {isImage ? (
              <Image source={{ uri: attachment.previewUri! }} style={styles.img} resizeMode="contain" />
            ) : (
              <View style={styles.empty}>
                <FileText size={40} color={colors.textMuted} />
                <ThemedText variant="muted" style={styles.emptyText}>
                  This file can’t be previewed here.
                </ThemedText>
              </View>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  panel: {
    width: '100%', maxWidth: 480, maxHeight: '85%',
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, padding: spacing.md,
  },
  name: { fontSize: 14, fontWeight: '600', flex: 1 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  body: { minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  img: { width: '100%', height: 360 },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
