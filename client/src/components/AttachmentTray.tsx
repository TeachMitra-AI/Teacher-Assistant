import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import { ATTACHMENT_TRAY_VISIBLE_COUNT } from '../config';
import type { AttachmentKind } from '../lib/attachmentValidation';
import AttachmentPreviewModal from './AttachmentPreviewModal';

// Maps an attachment kind to its icon. Only 'image' and 'pdf' exist (lib/attachmentValidation.ts); a new kind is one entry here
// and one in AttachmentKind/ALLOWED_ATTACHMENT_MIME_TYPES, since nothing else in the tray branches on kind.
const KIND_ICONS: Record<AttachmentKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
};

/**
 * The minimal shape the tray needs to render a chip. Not tied to useAttachments' SelectedAttachment (which carries a live
 * `File`): a sent message's attachments are display-only metadata (types.ts AttachmentMeta), so both the editable
 * (Composer) and read-only (MessageBubble) callers share this.
 */
export interface AttachmentTrayItem {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** Object URL for a live image selection; omitted/null renders the kind icon instead (always the case for a past message). */
  previewUrl?: string | null;
}

/**
 * How an item is drawn; everything else (overflow, remove, clear-all, wrapping) is shared, hence a variant of one component.
 * - `chips`: name plus small icon/thumbnail on a pill, for a sent message's attachments, where there's no live object URL.
 * - `preview`: a square thumbnail with no file name, for staged files in the Composer, where the picture is recognisable
 *   at once and the name would make the composer taller. Tapping opens it full-size (AttachmentPreviewModal).
 */
export type AttachmentTrayVariant = 'chips' | 'preview';

interface AttachmentTrayProps {
  attachments: AttachmentTrayItem[];
  /** Omit for a read-only tray (e.g. displaying a past message's attachments) — items render without a remove button. */
  onRemove?: (id: string) => void;
  /** Omit to hide the clear-all control even in an editable tray. */
  onClearAll?: () => void;
  disabled?: boolean;
  /** How many items show before collapsing the rest behind "+N more". Defaults to ATTACHMENT_TRAY_VISIBLE_COUNT. */
  visibleCount?: number;
  /** Defaults to 'chips' so every existing caller is unchanged. */
  variant?: AttachmentTrayVariant;
}

/** Renders attachment chips for the editable pre-send tray (Composer) and the read-only sent-message list (MessageBubble), so the rendering logic lives in one place. */
export default function AttachmentTray({
  attachments,
  onRemove,
  onClearAll,
  disabled,
  visibleCount = ATTACHMENT_TRAY_VISIBLE_COUNT,
  variant = 'chips',
}: AttachmentTrayProps) {
  const [expanded, setExpanded] = useState(false);
  // Stores the id and looks it up in the current list each render, so removing a file (or clear-all, or send) while its
  // preview is open closes the dialog instead of showing a revoked object URL.
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const overflowCount = attachments.length - visibleCount;
  const showAll = expanded || overflowCount <= 0;
  const visible = showAll ? attachments : attachments.slice(0, visibleCount);
  const Item = variant === 'preview' ? AttachmentPreview : AttachmentChip;
  const previewing = previewId ? attachments.find((a) => a.id === previewId) ?? null : null;

  return (
    <div className={`attachment-tray attachment-tray--${variant}`}>
      <div className="attachment-tray-chips">
        {visible.map((attachment) => (
          <Item
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemove}
            onOpen={variant === 'preview' ? (a) => setPreviewId(a.id) : undefined}
            disabled={disabled}
          />
        ))}
        {!showAll && (
          <button type="button" className="attachment-tray-more" onClick={() => setExpanded(true)}>
            +{overflowCount} more
          </button>
        )}
        {showAll && overflowCount > 0 && (
          <button type="button" className="attachment-tray-more" onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>
      {onClearAll && (
        <button
          type="button"
          className="icon-btn attachment-tray-clear"
          onClick={onClearAll}
          disabled={disabled}
          aria-label="Remove all attachments"
          title="Remove all attachments"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
      {previewing && <AttachmentPreviewModal attachment={previewing} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

interface AttachmentItemProps {
  attachment: AttachmentTrayItem;
  onRemove?: (id: string) => void;
  /** Preview variant only — opens the full-size dialog. */
  onOpen?: (attachment: AttachmentTrayItem) => void;
  disabled?: boolean;
}

/**
 * The 'preview' variant: the picture with no file name. A PDF (or an image with no object URL) falls back to its kind icon
 * on the same square tile so a mixed selection lines up. The name stays as the tile's `title` and in the remove button's
 * accessible name.
 */
function AttachmentPreview({ attachment, onRemove, onOpen, disabled }: AttachmentItemProps) {
  const Icon = KIND_ICONS[attachment.kind];
  const isImage = attachment.kind === 'image' && attachment.previewUrl;
  const thumb = isImage ? (
    <img src={attachment.previewUrl!} alt={attachment.name} className="attachment-preview-img" />
  ) : (
    <span className="attachment-preview-file" aria-hidden="true">
      <Icon size={20} />
    </span>
  );
  return (
    <span className="attachment-preview" title={attachment.name}>
      {/* A sibling of the remove button, not its parent (a button in a button is invalid HTML and browsers disagree on the
          click). With no object URL there's nothing to open, so it's plain markup instead of a button that does nothing. */}
      {onOpen && attachment.previewUrl ? (
        <button
          type="button"
          className="attachment-preview-open"
          onClick={() => onOpen(attachment)}
          aria-label={`Preview ${attachment.name}`}
        >
          {thumb}
        </button>
      ) : (
        thumb
      )}
      {onRemove && (
        <button
          type="button"
          className="attachment-preview-remove"
          onClick={() => onRemove(attachment.id)}
          disabled={disabled}
          aria-label={`Remove ${attachment.name}`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
  disabled,
}: AttachmentItemProps) {
  const Icon = KIND_ICONS[attachment.kind];
  return (
    <span className="attachment-chip" title={attachment.name}>
      {attachment.kind === 'image' && attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt="" className="attachment-chip-thumb" />
      ) : (
        <Icon size={14} className="attachment-chip-icon" aria-hidden="true" />
      )}
      <span className="attachment-chip-name">{attachment.name}</span>
      {onRemove && (
        <button
          type="button"
          className="attachment-chip-remove"
          onClick={() => onRemove(attachment.id)}
          disabled={disabled}
          aria-label={`Remove ${attachment.name}`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
