// Client-side attachment checks (Coach image/PDF upload): pure functions with no DOM/React dependency beyond `File`.
// A courtesy, not a security boundary: it gives a quick rejection before upload. The real gate is server-side byte sniffing
// (server/src/lib/fileValidation.js); a `File.type` is as spoofable as any client-supplied value.
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_MB,
  MAX_ATTACHMENTS_COUNT,
  MAX_ATTACHMENTS_TOTAL_SIZE_MB,
} from '../config';

export type AttachmentKind = 'image' | 'pdf';

/** Maps an allowed mimeType to the coarse kind the UI cares about (thumbnail vs file icon). */
export function attachmentKind(mimeType: string): AttachmentKind | null {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  return null;
}

export type AttachmentValidationResult = { ok: true } | { ok: false; message: string };

/** Checks a File against the same two bounds the server enforces (type allowlist, size cap). Advisory only, and it doesn't sniff bytes (no cheap way before upload); a mismatched declared type is caught server-side. */
export function validateAttachmentFile(file: File): AttachmentValidationResult {
  if (file.size === 0) {
    return { ok: false, message: 'This file is empty.' };
  }
  if (file.size > MAX_ATTACHMENT_SIZE_MB * 1024 * 1024) {
    return { ok: false, message: `The file is too large. Maximum size is ${MAX_ATTACHMENT_SIZE_MB}MB.` };
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: 'Unsupported file type. Please attach a JPEG, PNG, WEBP image or a PDF.' };
  }
  return { ok: true };
}

export interface AttachmentBatchResult {
  /** Newly selected files that fit within the type, size, count and combined-size bounds, in selection order. */
  accepted: File[];
  /** One combined message if anything was dropped; null if every file was accepted. */
  error: string | null;
}

/**
 * Filters newly selected files against the ones already selected. All files go to Gemini together in one request
 * (server/src/attachments/describeAttachment.js), so the count and combined-size bounds apply across the whole tray. It
 * accepts as many valid files as fit and reports the rest in one message ("select 6 when the limit is 5" keeps the first 5).
 * @param existingSizes sizes (bytes) of files already in the tray, in selection order
 * @param newFiles the files just picked from the OS file dialog
 */
export function validateNewAttachments(existingSizes: number[], newFiles: File[]): AttachmentBatchResult {
  const maxTotalBytes = MAX_ATTACHMENTS_TOTAL_SIZE_MB * 1024 * 1024;
  let count = existingSizes.length;
  let totalBytes = existingSizes.reduce((sum, size) => sum + size, 0);

  const accepted: File[] = [];
  let invalidCount = 0;
  let droppedForCount = 0;
  let droppedForSize = 0;

  for (const file of newFiles) {
    const perFile = validateAttachmentFile(file);
    if (!perFile.ok) {
      invalidCount += 1;
      continue;
    }
    if (count >= MAX_ATTACHMENTS_COUNT) {
      droppedForCount += 1;
      continue;
    }
    if (totalBytes + file.size > maxTotalBytes) {
      droppedForSize += 1;
      continue;
    }
    accepted.push(file);
    count += 1;
    totalBytes += file.size;
  }

  const messages: string[] = [];
  if (invalidCount > 0) {
    messages.push(
      invalidCount === 1
        ? "1 file wasn't added (unsupported type or too large)."
        : `${invalidCount} files weren't added (unsupported type or too large).`
    );
  }
  if (droppedForCount > 0) {
    messages.push(`Only up to ${MAX_ATTACHMENTS_COUNT} files can be attached at once.`);
  }
  if (droppedForSize > 0) {
    messages.push(`The rest would exceed the ${MAX_ATTACHMENTS_TOTAL_SIZE_MB}MB combined limit.`);
  }

  return { accepted, error: messages.length > 0 ? messages.join(' ') : null };
}
