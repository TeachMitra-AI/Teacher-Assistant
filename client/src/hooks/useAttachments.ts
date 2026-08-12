import { useCallback, useEffect, useRef, useState } from 'react';
import { attachmentKind, validateNewAttachments, type AttachmentKind } from '../lib/attachmentValidation';

export interface SelectedAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  // An object URL for the local file — the image thumbnail in the composer,
  // and the source for the full-size preview dialog (AttachmentPreviewModal),
  // where a PDF is handed to the browser's built-in viewer. Created for EVERY
  // kind, not just images: a PDF still shows a file icon rather than a
  // thumbnail in the tray, but without a URL it could not be opened for
  // preview at all. Costs nothing but a handle — an object URL does not copy
  // the file — and is revoked on remove/clear/unmount like every other one.
  previewUrl: string | null;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `att${Date.now()}${Math.random()}`;
}

/**
 * Manages the collection of files a teacher can attach to a Coach question —
 * add (one or many at once), validate as a batch (count + combined size,
 * client-side courtesy only, see lib/attachmentValidation.ts), preview,
 * remove one, or clear all. All currently-selected files are sent to Gemini
 * TOGETHER in one request when the message is sent (see
 * docs/multimodal-attachments-architecture.md) — this hook's job is only to
 * manage what's staged for that one request, not to send anything itself.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Object URLs are tracked in a ref (not derived from state) so every one
  // can be revoked on unmount without depending on the latest render's
  // closure — mirrors the single-attachment hook's original approach, just
  // keyed by attachment id now that there can be more than one.
  const previewUrlsRef = useRef<Map<string, string>>(new Map());

  const revokeAll = useCallback(() => {
    for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  // Revoke everything on unmount only — remove()/clear() below revoke their
  // own targets explicitly on their own paths.
  useEffect(() => () => revokeAll(), [revokeAll]);

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const { accepted, error: batchError } = validateNewAttachments(
        attachments.map((a) => a.file.size),
        files
      );
      setError(batchError);
      if (accepted.length === 0) return;

      const newOnes: SelectedAttachment[] = [];
      for (const file of accepted) {
        const kind = attachmentKind(file.type);
        // Unreachable in practice — validateNewAttachments already checked
        // the mimeType against the same allowlist attachmentKind reads — but
        // a file with no recognized kind is simply skipped rather than
        // asserted, since a File's `.type` is browser-reported, not
        // something this code controls.
        if (!kind) continue;
        const id = newId();
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.set(id, previewUrl);
        newOnes.push({ id, file, kind, previewUrl });
      }

      setAttachments((current) => [...current, ...newOnes]);
    },
    [attachments]
  );

  const remove = useCallback((id: string) => {
    const url = previewUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(id);
    }
    setAttachments((current) => current.filter((a) => a.id !== id));
    setError(null);
  }, []);

  const clear = useCallback(() => {
    revokeAll();
    setAttachments([]);
    setError(null);
  }, [revokeAll]);

  return { attachments, error, add, remove, clear };
}
