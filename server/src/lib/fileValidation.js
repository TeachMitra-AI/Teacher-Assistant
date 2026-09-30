// Attachment file validation: magic-byte sniffing, allowlist and size caps. It decides whether an uploaded
// buffer is safe to hand to Gemini inline. It never touches disk and knows nothing about HTTP or multer.
// It uses magic bytes rather than the declared Content-Type, which the client controls. The leading bytes are the
// only trustworthy signal, so this is the real gate; client checks and multer's fileFilter are just fast rejections.

const MIME_JPEG = 'image/jpeg';
const MIME_PNG = 'image/png';
const MIME_WEBP = 'image/webp';
const MIME_PDF = 'application/pdf';

// Hard allowlist, not env-configurable: widening the formats Gemini receives raw is a code change with its own review.
const ALLOWED_MIME_TYPES = Object.freeze([MIME_JPEG, MIME_PNG, MIME_WEBP, MIME_PDF]);

/** Each signature is checked at a fixed byte offset. WEBP needs two checks (RIFF at 0, "WEBP" at 8) since RIFF alone isn't specific. */
const SIGNATURES = [
  { mimeType: MIME_JPEG, offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mimeType: MIME_PNG, offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: MIME_WEBP, offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
  { mimeType: MIME_PDF, offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
];
const WEBP_TAG_OFFSET = 8;
const WEBP_TAG_BYTES = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function matchesSignature(buffer, { offset, bytes }) {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Sniffs the real file format from its leading bytes; null means no allowed signature matched, and the
 * caller treats that as a hard rejection whatever the client declared.
 * @param {Buffer} buffer
 * @returns {string|null} one of ALLOWED_MIME_TYPES, or null
 */
function sniffMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  for (const sig of SIGNATURES) {
    if (!matchesSignature(buffer, sig)) continue;
    if (sig.mimeType === MIME_WEBP) {
      if (buffer.length < WEBP_TAG_OFFSET + WEBP_TAG_BYTES.length) continue;
      const tagMatches = WEBP_TAG_BYTES.every((b, i) => buffer[WEBP_TAG_OFFSET + i] === b);
      if (!tagMatches) continue;
    }
    return sig.mimeType;
  }
  return null;
}

/**
 * Cheap PDF page-count estimate (not a real parse): counts `/Type /Page` markers, since a byte cap alone doesn't
 * bound Gemini's per-page cost. If the marker isn't found (e.g. object streams) it returns null and the caller
 * allows it: this is a cost guard, and a false rejection would block a legitimate file.
 * @param {Buffer} buffer
 * @returns {number|null}
 */
function estimatePdfPageCount(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches && matches.length > 0 ? matches.length : null;
}

/**
 * Full validation pass for an uploaded attachment buffer.
 * @param {Buffer} buffer
 * @param {{ maxBytes: number, maxPdfPages: number }} limits
 * @returns {{ ok: true, mimeType: string } | { ok: false, code: string, message: string }}
 */
function validateAttachment(buffer, limits) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'The uploaded file is empty.' };
  }
  if (buffer.length > limits.maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `The file is too large. Maximum size is ${Math.floor(limits.maxBytes / (1024 * 1024))}MB.`,
    };
  }

  const mimeType = sniffMimeType(buffer);
  if (!mimeType) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Unsupported file type. Please upload a JPEG, PNG, WEBP image or a PDF.',
    };
  }

  if (mimeType === MIME_PDF) {
    const pageCount = estimatePdfPageCount(buffer);
    if (pageCount !== null && pageCount > limits.maxPdfPages) {
      return {
        ok: false,
        code: 'PDF_TOO_MANY_PAGES',
        message: `This PDF has too many pages (estimated ${pageCount}). Maximum is ${limits.maxPdfPages} pages.`,
      };
    }
  }

  return { ok: true, mimeType };
}

/**
 * Validates a batch of attachment buffers sent to Gemini together (see attachments/describeAttachment.js).
 * Reuses validateAttachment per file and adds two batch-level checks: file count (run first, so too many files
 * fails fast) and combined size. The aggregate check isn't redundant with maxBytes x maxFiles: Gemini's
 * inline ceiling applies to the whole request, and base64 adds ~33%.
 * It fails on the first problem found; a partial batch isn't salvaged (see routes/attachments.js).
 * @param {Buffer[]} buffers
 * @param {{ maxBytes: number, maxPdfPages: number, maxFiles: number, maxTotalBytes: number }} limits
 * @returns {{ ok: true, files: Array<{ mimeType: string }> } | { ok: false, code: string, message: string }}
 */
function validateAttachmentBatch(buffers, limits) {
  if (!buffers || buffers.length === 0) {
    return { ok: false, code: 'FILE_REQUIRED', message: 'At least one file is required.' };
  }
  if (buffers.length > limits.maxFiles) {
    return {
      ok: false,
      code: 'TOO_MANY_FILES',
      message: `Too many files attached. Maximum is ${limits.maxFiles} at once.`,
    };
  }

  let totalBytes = 0;
  const files = [];
  for (const buffer of buffers) {
    totalBytes += buffer ? buffer.length : 0;
    const result = validateAttachment(buffer, limits);
    if (!result.ok) return result;
    files.push({ mimeType: result.mimeType });
  }

  if (totalBytes > limits.maxTotalBytes) {
    return {
      ok: false,
      code: 'BATCH_TOO_LARGE',
      message: `These files together are too large. Maximum combined size is ${Math.floor(limits.maxTotalBytes / (1024 * 1024))}MB.`,
    };
  }

  return { ok: true, files };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  sniffMimeType,
  estimatePdfPageCount,
  validateAttachment,
  validateAttachmentBatch,
};
