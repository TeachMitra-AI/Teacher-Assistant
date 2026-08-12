import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { AttachmentTrayItem } from './AttachmentTray';

/**
 * A staged file, shown large enough to actually read — opened by tapping its
 * thumbnail in the Composer.
 *
 * The thumbnails deliberately show no file name and are only 56px, which is
 * enough to recognise a photo you took ten seconds ago but not enough to check
 * that you photographed the RIGHT page, or that the whole worksheet is in
 * frame. This is where that check happens, so a teacher never has to send a
 * question to find out the picture was unusable.
 *
 * Portalled to document.body for the same reason ContextBar's popover is: the
 * composer dock becomes a scroll container once the resize handle shrinks it,
 * and a dialog rendered inside it would be clipped by that scrolling.
 */
interface AttachmentPreviewModalProps {
  attachment: AttachmentTrayItem;
  onClose: () => void;
}

/**
 * Whether this browser can render a PDF in an iframe. `pdfViewerEnabled` is
 * the standard signal and is false when the viewer is switched off by policy
 * or simply absent (headless Chromium, some embedded browsers). Anything that
 * does not report the property at all is assumed capable — the property is the
 * newer thing, not the viewer, so treating "unknown" as "missing" would send
 * capable browsers down the fallback path.
 */
function canEmbedPdf(): boolean {
  return typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;
}

export default function AttachmentPreviewModal({ attachment, onClose }: AttachmentPreviewModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Whatever had focus when the dialog opened — the thumbnail button. Restored
  // on close so a keyboard user lands back where they were rather than at the
  // top of the document.
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // The page behind must not scroll while the dialog is open — on a phone a
    // drag on the backdrop otherwise scrolls the chat underneath it.
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
      // Only a click on the backdrop ITSELF closes — a click that started
      // inside the panel (e.g. dragging to select) must not dismiss it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="attachment-modal" role="dialog" aria-modal="true" aria-label={attachment.name}>
        <div className="attachment-modal-head">
          {/* The name IS shown here, unlike on the thumbnail: the thumbnail is
              a glance at a picture the teacher just picked, this is the place
              they came to to identify a file deliberately. */}
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
            // The browser's own PDF viewer. No PDF library is pulled in for
            // this: every browser that has a viewer can already render one, and
            // the file is a local object URL, so nothing is uploaded to preview
            // it.
            <iframe src={attachment.previewUrl} title={attachment.name} className="attachment-modal-frame" />
          ) : attachment.previewUrl ? (
            // No built-in viewer (it can be switched off by policy, and some
            // stripped-down/embedded browsers ship without one). An <iframe>
            // there renders a BLANK WHITE PANEL with no explanation, which
            // looks like the file failed to upload — so say what happened and
            // offer the one thing that still works.
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
