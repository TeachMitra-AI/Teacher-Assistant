// Attachment file validation — magic-byte sniffing, allowlist, size caps.
//
// SCOPE: this module exists for exactly one thing — deciding whether an
// uploaded buffer is safe to hand to Gemini as an inline attachment. It never
// touches disk, never persists anything, and has no knowledge of HTTP,
// multer, or the route that calls it (a leaf module, same convention as
// lib/geminiPolicy.js and lib/resourceFields.js).
//
// WHY MAGIC BYTES, NOT THE DECLARED Content-Type: multer's fileFilter only
// sees what the CLIENT claims the mimetype is, which is trivially spoofable
// (a teacher's browser sets it from the file extension, and a hostile client
// can set it to anything). The only trustworthy signal is the actual leading
// bytes of the file, checked against each format's published signature. This
// is the ONE validation layer in the pipeline that is not just a courtesy —
// everything upstream of it (client-side checks, multer's fileFilter) is a
// fast, friendly rejection; this is the real gate.

const MIME_JPEG = 'image/jpeg';
const MIME_PNG = 'image/png';
const MIME_WEBP = 'image/webp';
const MIME_PDF = 'application/pdf';

// Hard allowlist. Deliberately not env-configurable (unlike most tunables in
// this app) — widening the set of formats Gemini receives raw bytes for is a
// code change with its own review, not a runtime flag flip.
const ALLOWED_MIME_TYPES = Object.freeze([MIME_JPEG, MIME_PNG, MIME_WEBP, MIME_PDF]);

/**
 * Each signature is checked at a fixed byte offset. WEBP needs two checks
 * (the RIFF container at 0 and the "WEBP" tag at 8) because RIFF alone is not
 * specific to WebP.
 */
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
 * Sniffs the actual file format from its leading bytes. Returns null if the
 * buffer doesn't match any allowed signature — the caller treats that as a
 * hard rejection regardless of what the client declared.
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
 * Cheap PDF page-count estimate — NOT a real parse. Counts occurrences of the
 * `/Type /Page` object marker, which is present once per page in the vast
 * majority of PDFs (including scanned/photographed documents, which is the
 * realistic case here). This exists because a byte-size cap alone does not
 * bound Gemini's per-page processing cost for a PDF — a well-compressed
 * multi-hundred-page PDF can be small in bytes while expensive to process.
 * Deliberately conservative: if the marker can't be found (an unusual PDF
 * structure, e.g. object streams), this returns null and the caller treats
 * an unknown page count as "allow" rather than "reject" — this is a cost
 * guard, not a correctness gate, and a false rejection would block a
 * legitimate small file for no reason.
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
 * Validates a BATCH of attachment buffers for one request — the true
 * multi-attachment case, where every file in the batch is sent to Gemini
 * together (see attachments/describeAttachment.js). Reuses validateAttachment
 * per file rather than duplicating its checks; adds exactly two checks that
 * only make sense at the batch level: how many files, and how much combined
 * weight they carry.
 *
 * THE COUNT CHECK RUNS BEFORE PER-FILE WORK, so a request with too many files
 * fails fast without sniffing bytes it's about to reject anyway. THE
 * AGGREGATE-SIZE CHECK IS NOT REDUNDANT WITH maxBytes x maxFiles: Gemini's
 * inline-data request ceiling is a property of the WHOLE request (base64
 * encoding adds ~33% on top of raw bytes), so five files each just under the
 * per-file cap could still produce a request too large for Gemini to accept,
 * or slow enough to hurt latency — this check is what actually protects
 * against that, independent of the per-file cap.
 *
 * Fails on the FIRST problem found (empty/oversized/unsupported file, too
 * many files, or too much combined weight) rather than collecting every
 * issue — matches validateAttachment's own "one clear reason" contract, and
 * a partial batch is not a case this app tries to salvage (see
 * routes/attachments.js: the whole request is one message, so a bad file in
 * it means the whole message failed to attach, not that N-1 of them quietly
 * went through).
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
