import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import { ATTACHMENT_TRAY_VISIBLE_COUNT } from '../config';
import type { AttachmentKind } from '../lib/attachmentValidation';

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

interface AttachmentTrayProps {
  attachments: AttachmentTrayItem[];
  /** Omit for a read-only tray (e.g. displaying a past message's attachments) — chips render without a remove button. */
  onRemove?: (id: string) => void;
  /** Omit to hide the clear-all control even in an editable tray. */
  onClearAll?: () => void;
  disabled?: boolean;
  /** How many chips show before collapsing the rest behind "+N more". Defaults to ATTACHMENT_TRAY_VISIBLE_COUNT. */
  visibleCount?: number;
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
}: AttachmentTrayProps) {
  const [expanded, setExpanded] = useState(false);

  if (attachments.length === 0) return null;

  const overflowCount = attachments.length - visibleCount;
  const showAll = expanded || overflowCount <= 0;
  const visible = showAll ? attachments : attachments.slice(0, visibleCount);

  return (
    <div className="attachment-tray">
      <div className="attachment-tray-chips">
        {visible.map((attachment) => (
          <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemove} disabled={disabled} />
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
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
  disabled,
}: {
  attachment: AttachmentTrayItem;
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
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
