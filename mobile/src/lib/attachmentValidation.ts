// Native port of client/src/lib/attachmentValidation.ts — pure functions, no
// DOM `File` dependency. RN pickers (expo-image-picker/expo-document-picker)
// hand back a {uri, name, mimeType, size} shape instead of a File, so these
// operate on that shape (PickableFile) rather than importing DOM lib types.
//
// THIS IS A COURTESY, NOT A SECURITY BOUNDARY — same as the web version. The
// real gate is server-side byte-sniffing (server/src/lib/fileValidation.js),
// which never trusts a client-declared mimeType.
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_MB,
  MAX_ATTACHMENTS_COUNT,
  MAX_ATTACHMENTS_TOTAL_SIZE_MB,
} from '../config';

export type AttachmentKind = 'image' | 'pdf';

/** Maps an allowed mimeType to the coarse kind the UI cares about (thumbnail vs. file icon). */
export function attachmentKind(mimeType: string): AttachmentKind | null {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  return null;
}

export interface PickableFile {
  size: number;
  mimeType: string;
}

export type AttachmentValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Checks a picked file against the same two bounds the server enforces (type
 * allowlist, size cap). Deliberately does NOT check for a zero-byte file —
 * unlike a browser File's `.size`, expo-image-picker/expo-document-picker do
 * not reliably report `size` on every platform, and treating an unreported
 * size as "empty" would wrongly reject a real photo.
 */
export function validateAttachmentFile(file: PickableFile): AttachmentValidationResult {
  if (file.size > MAX_ATTACHMENT_SIZE_MB * 1024 * 1024) {
    return { ok: false, message: `The file is too large. Maximum size is ${MAX_ATTACHMENT_SIZE_MB}MB.` };
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimeType)) {
    return { ok: false, message: 'Unsupported file type. Please attach a JPEG, PNG, WEBP image or a PDF.' };
  }
  return { ok: true };
}

export interface AttachmentBatchResult<T> {
  /** Newly-picked files that fit within type, size, count, and combined-size bounds — in pick order. */
  accepted: T[];
  /** One combined, human-readable message if anything was dropped; null if every file was accepted. */
  error: string | null;
}

/**
 * Filters a newly-picked set of files against the currently-selected ones —
 * see client/src/lib/attachmentValidation.ts's validateNewAttachments for the
 * full reasoning (identical here; only the input shape differs). Generic over
 * T so callers keep the full picked-file object (uri/name included) on the
 * accepted list, not just the {size, mimeType} this function reads.
 */
export function validateNewAttachments<T extends PickableFile>(
  existingSizes: number[],
  newFiles: T[]
): AttachmentBatchResult<T> {
  const maxTotalBytes = MAX_ATTACHMENTS_TOTAL_SIZE_MB * 1024 * 1024;
  let count = existingSizes.length;
  let totalBytes = existingSizes.reduce((sum, size) => sum + size, 0);

  const accepted: T[] = [];
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
