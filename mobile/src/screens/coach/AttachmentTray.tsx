// Native port of client/src/components/AttachmentTray.tsx — one place
// attachment chips get rendered, reused for both the pre-send tray in
// Composer (editable: onRemove passed) and a sent message's attachments in
// MessageBubble (read-only: onRemove omitted). See the web version's doc
// comment for the 'chips' vs 'preview' variant reasoning — identical here.
import React, { useState } from 'react';
import { View, Pressable, Image, StyleSheet } from 'react-native';
import { FileText, Image as ImageIcon, X, type LucideIcon } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { ATTACHMENT_TRAY_VISIBLE_COUNT } from '../../config';
import type { AttachmentKind } from '../../lib/attachmentValidation';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';

const KIND_ICONS: Record<AttachmentKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
};

/** The minimal shape the tray needs to render a chip — see the web version's
 *  doc comment for why this is deliberately not tied to SelectedAttachment. */
export interface AttachmentTrayItem {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** Local file uri for a live selection; omitted for a past message's attachment (display-only metadata, no file kept). */
  previewUri?: string | null;
}

export type AttachmentTrayVariant = 'chips' | 'preview';

interface AttachmentTrayProps {
  attachments: AttachmentTrayItem[];
  /** Omit for a read-only tray — items render without a remove button. */
  onRemove?: (id: string) => void;
  disabled?: boolean;
  visibleCount?: number;
  /** Defaults to 'chips' so a read-only caller needs no extra prop. */
  variant?: AttachmentTrayVariant;
}

export function AttachmentTray({
  attachments,
  onRemove,
  disabled,
  visibleCount = ATTACHMENT_TRAY_VISIBLE_COUNT,
  variant = 'chips',
}: AttachmentTrayProps) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const overflowCount = attachments.length - visibleCount;
  const showAll = expanded || overflowCount <= 0;
  const visible = showAll ? attachments : attachments.slice(0, visibleCount);
  const previewing = previewId ? attachments.find((a) => a.id === previewId) ?? null : null;

  return (
    <View style={styles.container}>
      <View style={styles.chips}>
        {visible.map((attachment) =>
          variant === 'preview' ? (
            <AttachmentPreview
              key={attachment.id}
              attachment={attachment}
              onRemove={onRemove}
              onOpen={() => setPreviewId(attachment.id)}
              disabled={disabled}
            />
          ) : (
            <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemove} disabled={disabled} />
          )
        )}
        {!showAll && (
          <Pressable onPress={() => setExpanded(true)} style={[styles.more, { borderColor: colors.border }]}>
            <ThemedText variant="muted" style={styles.moreText}>+{overflowCount} more</ThemedText>
          </Pressable>
        )}
        {showAll && overflowCount > 0 && (
          <Pressable onPress={() => setExpanded(false)} style={[styles.more, { borderColor: colors.border }]}>
            <ThemedText variant="muted" style={styles.moreText}>Show less</ThemedText>
          </Pressable>
        )}
      </View>
      {previewing && <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewId(null)} />}
    </View>
  );
}

interface AttachmentItemProps {
  attachment: AttachmentTrayItem;
  onRemove?: (id: string) => void;
  onOpen?: () => void;
  disabled?: boolean;
}

/** 'preview' variant: a square thumbnail, no file name — the staged tray inside the Composer box. */
function AttachmentPreview({ attachment, onRemove, onOpen, disabled }: AttachmentItemProps) {
  const { colors } = useTheme();
  const Icon = KIND_ICONS[attachment.kind];
  const isImage = attachment.kind === 'image' && attachment.previewUri;

  return (
    <View style={styles.previewWrap}>
      <Pressable
        onPress={onOpen}
        disabled={!isImage}
        accessibilityRole="button"
        accessibilityLabel={`Preview ${attachment.name}`}
        style={[styles.previewTile, { backgroundColor: colors.surface2, borderColor: colors.border }]}
      >
        {isImage ? (
          <Image source={{ uri: attachment.previewUri! }} style={styles.previewImg} />
        ) : (
          <Icon size={20} color={colors.textMuted} />
        )}
      </Pressable>
      {onRemove && (
        <Pressable
          onPress={() => onRemove(attachment.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${attachment.name}`}
          hitSlop={6}
          style={[styles.removeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <X size={11} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

/** 'chips' variant: name + small icon/thumbnail on a pill — a sent message's attachments. */
function AttachmentChip({ attachment, onRemove, disabled }: AttachmentItemProps) {
  const { colors } = useTheme();
  const Icon = KIND_ICONS[attachment.kind];
  return (
    <View style={[styles.chip, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      {attachment.kind === 'image' && attachment.previewUri ? (
        <Image source={{ uri: attachment.previewUri }} style={styles.chipThumb} />
      ) : (
        <Icon size={13} color={colors.textMuted} />
      )}
      <ThemedText style={styles.chipName} numberOfLines={1}>{attachment.name}</ThemedText>
      {onRemove && (
        <Pressable
          onPress={() => onRemove(attachment.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${attachment.name}`}
          hitSlop={6}
        >
          <X size={12} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  previewWrap: { width: 52, height: 52 },
  previewTile: {
    width: 52, height: 52, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  previewImg: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: 160,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4, paddingHorizontal: spacing.sm,
  },
  chipThumb: { width: 16, height: 16, borderRadius: 3 },
  chipName: { fontSize: 12, flexShrink: 1 },
  more: { borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  moreText: { fontSize: 12, fontWeight: '600' },
});
