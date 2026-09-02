// Native port of client/src/hooks/useAttachments.ts — manages the collection
// of files a teacher can attach to a Coach question (add, validate as a
// batch, remove one, or clear all). All currently-selected files are sent to
// Gemini TOGETHER in one request when the message is sent (see
// docs/multimodal-attachments-architecture.md and api/coach.ts's
// askCoachWithAttachments) — this hook only manages what's staged for that
// one request.
//
// No object-URL bookkeeping here (unlike the web version): a picked file's
// `uri` already points at a local file (the OS photo library / cache
// directory / document provider), nothing to create or revoke.
import { useCallback, useState } from 'react';
import { attachmentKind, validateNewAttachments, type AttachmentKind } from './attachmentValidation';

/** What AddMenu hands back from the camera or the document picker. */
export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface SelectedAttachment extends PickedFile {
  id: string;
  kind: AttachmentKind;
}

function newId(): string {
  return `att${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export function useAttachments() {
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    (files: PickedFile[]) => {
      if (files.length === 0) return;

      const { accepted, error: batchError } = validateNewAttachments(
        attachments.map((a) => a.size),
        files
      );
      setError(batchError);
      if (accepted.length === 0) return;

      const newOnes: SelectedAttachment[] = [];
      for (const file of accepted) {
        const kind = attachmentKind(file.mimeType);
        // Unreachable in practice — validateNewAttachments already checked
        // the mimeType against the same allowlist attachmentKind reads.
        if (!kind) continue;
        newOnes.push({ ...file, id: newId(), kind });
      }

      setAttachments((current) => [...current, ...newOnes]);
    },
    [attachments]
  );

  const remove = useCallback((id: string) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
    setError(null);
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setError(null);
  }, []);

  return { attachments, error, add, remove, clear };
}
