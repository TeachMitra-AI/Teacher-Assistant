import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { AttachmentTrayItem } from './AttachmentTray';

/**
 * A staged file shown large enough to read, opened from its Composer thumbnail. The 56px name-less thumbnails are enough to
 * recognise a photo but not to check you captured the right page, so this is where that check happens before sending.
 * Portalled to document.body because the composer dock becomes a scroll container when the resize handle shrinks it, which
 * would clip a dialog rendered inside.
 */
interface AttachmentPreviewModalProps {
  attachment: AttachmentTrayItem;
  onClose: () => void;
}

/**
 * Whether this browser can render a PDF in an iframe. `pdfViewerEnabled` is false when the viewer is off by policy or absent
 * (headless Chromium, some embedded browsers). A browser that doesn't report it at all is assumed capable, since the
 * property is newer than the viewer.
 */
function canEmbedPdf(): boolean {
  return typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;
}

export default function AttachmentPreviewModal({ attachment, onClose }: AttachmentPreviewModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // What had focus when the dialog opened (the thumbnail button), restored on close so keyboard users land back there.
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // The page behind mustn't scroll while open; on a phone a drag on the backdrop would scroll the chat.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const target = returnFocusRef.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, [onClose]);

  const isImage = attachment.kind === 'image' && attachment.previewUrl;

  return createPortal(
    <div
      className="attachment-modal-backdrop"
      // Only a click on the backdrop itself closes; one that started inside the panel (e.g. drag-select) mustn't dismiss it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="attachment-modal" role="dialog" aria-modal="true" aria-label={attachment.name}>
        <div className="attachment-modal-head">
          {/* The name is shown here, unlike on the thumbnail: this is where a teacher identifies a file deliberately. */}
          <span className="attachment-modal-name" title={attachment.name}>{attachment.name}</span>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn attachment-modal-close"
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="attachment-modal-body">
          {isImage ? (
            <img src={attachment.previewUrl!} alt={attachment.name} className="attachment-modal-img" />
          ) : attachment.previewUrl && canEmbedPdf() ? (
            // The browser's own PDF viewer: no PDF library needed, and the file is a local object URL so nothing is uploaded.
            <iframe src={attachment.previewUrl} title={attachment.name} className="attachment-modal-frame" />
          ) : attachment.previewUrl ? (
            // No built-in viewer (off by policy or absent in stripped-down browsers). An <iframe> would show a blank panel that
            // looks like a failed upload, so say what happened and offer what still works.
            <p className="attachment-modal-empty">
              This browser can’t show PDFs inside the app.{' '}
              <a href={attachment.previewUrl} target="_blank" rel="noreferrer">Open it in a new tab</a>.
            </p>
          ) : (
            <p className="attachment-modal-empty">This file can’t be previewed.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
