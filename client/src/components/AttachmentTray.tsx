import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import { ATTACHMENT_TRAY_VISIBLE_COUNT } from '../config';
import type { AttachmentKind } from '../lib/attachmentValidation';
import AttachmentPreviewModal from './AttachmentPreviewModal';

// One place that maps a kind to its icon. Only 'image' and 'pdf' exist today
// (see lib/attachmentValidation.ts's AttachmentKind), but the tray itself
// never branches on kind anywhere else — adding a future kind (DOCX, PPTX,
// TXT, an OCR output) is a two-line change: one entry here, one in
// AttachmentKind/ALLOWED_ATTACHMENT_MIME_TYPES. Everything else in this
// component (chip layout, +N more, remove, clear-all, responsiveness)
// already works for any kind without modification.
const KIND_ICONS: Record<AttachmentKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
};

/**
 * The minimal shape the tray needs to render a chip — deliberately NOT tied
 * to useAttachments' SelectedAttachment (which carries a live `File` and only
 * exists pre-send). A past message's attachments are display-only metadata
 * (types.ts's AttachmentMeta — no File, no live object URL, since neither is
 * kept once a turn is sent), so this interface is what both the editable
 * (Composer) and read-only (MessageBubble) callers can share.
 */
export interface AttachmentTrayItem {
  id: string;
  name: string;
  kind: AttachmentKind;
  /** Object URL for a live image selection; omitted/null renders the kind icon instead (always the case for a past message). */
  previewUrl?: string | null;
}

/**
 * How an item is drawn. Everything else about the tray — overflow, remove,
 * clear-all, wrapping — is identical between the two, which is why this is a
 * variant of one component rather than a second component.
 *
 * - `chips`   name + small icon/thumbnail on a pill. Used for a SENT message's
 *             attachments (MessageBubble), where there is no live object URL to
 *             preview and the name is the only thing identifying the file.
 * - `preview` a square thumbnail of the image itself and NO file name. Used for
 *             the staged files inside the Composer box, where the teacher picked
 *             the file seconds ago and recognises the picture instantly — the
 *             name is noise that makes the composer taller for nothing. Tapping
 *             one opens it full-size (AttachmentPreviewModal), which is where a
 *             teacher checks they photographed the right page.
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

/**
 * The one place attachment chips get rendered — reused as-is for the
 * pre-send tray in Composer (editable: onRemove/onClearAll wired up) and for
 * a sent message's attachments in MessageBubble (read-only: neither passed).
 * Kept as a single component specifically so rendering logic (chips,
 * thumbnails, icons, +N more, remove, clear-all, responsive wrap) never has
 * to be duplicated or kept in sync across two places.
 */
export default function AttachmentTray({
  attachments,
  onRemove,
  onClearAll,
  disabled,
  visibleCount = ATTACHMENT_TRAY_VISIBLE_COUNT,
  variant = 'chips',
}: AttachmentTrayProps) {
  const [expanded, setExpanded] = useState(false);
  // The id, not the item: looked up against the CURRENT list on every render,
  // so a file removed while its preview is open (or a clear-all, or a send)
  // closes the dialog instead of leaving it showing a revoked object URL.
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
 * The 'preview' variant: the picture itself, no file name. A PDF (or an image
 * with no live object URL) falls back to its kind icon on the same square tile,
 * so a mixed selection still lines up as one row of equal-sized tiles.
 *
 * The name is not rendered but is NOT thrown away — it stays as the tile's
 * `title` and inside the remove button's accessible name, so a screen reader
 * and a hover tooltip can both still say which file this is.
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
      {/* A SIBLING of the remove button, not its parent: a button inside a
          button is invalid HTML and browsers disagree about which one a click
          activates. Nothing to open (no object URL) ⇒ plain, non-interactive
          markup rather than a button that would do nothing when pressed. */}
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
