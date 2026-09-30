import { useCallback, useEffect, useRef, useState } from 'react';
import { attachmentKind, validateNewAttachments, type AttachmentKind } from '../lib/attachmentValidation';

export interface SelectedAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  // Object URL for the local file: the thumbnail in the composer and the source for the full-size preview (a PDF goes to the
  // browser's viewer). Created for every kind, since a PDF needs one to be previewable. Costs only a handle and is revoked on
  // remove/clear/unmount.
  previewUrl: string | null;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `att${Date.now()}${Math.random()}`;
}

/**
 * Manages the files a teacher attaches to a Coach question: add, batch-validate (count + combined size; a client courtesy,
 * see lib/attachmentValidation.ts), preview, remove or clear. All files go to Gemini together in one request on send
 * (docs/multimodal-attachments-architecture.md); this hook only manages what's staged.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Object URLs live in a ref so every one can be revoked on unmount without depending on the latest render's closure.
  const previewUrlsRef = useRef<Map<string, string>>(new Map());

  const revokeAll = useCallback(() => {
    for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  // Revoke everything on unmount only; remove()/clear() revoke their own targets.
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
        // Unreachable in practice (the mimeType was already checked against the same allowlist), but a file with no
        // recognized kind is skipped rather than asserted, since `.type` is browser-reported.
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
