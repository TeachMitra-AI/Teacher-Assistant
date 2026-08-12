// PYQ source-document upload validation — extends lib/fileValidation.js with
// PYQ-sized ceilings (a bound multi-page exam-paper compilation, not a single
// chat attachment). See docs/pyq-implementation-plan.md §5/§14, Phase 2.
//
// SCOPE: this module owns exactly the same kind of decision
// lib/fileValidation.js does ("is this buffer safe/allowed to store"), but
// narrower — a PYQ source document is always a PDF (a scanned/born-digital
// exam paper), never an image, so this never accepts the JPEG/PNG/WEBP
// signatures that module's ALLOWED_MIME_TYPES does. Reuses sniffMimeType and
// estimatePdfPageCount directly rather than re-implementing byte-signature
// checking — the magic-byte-over-declared-Content-Type reasoning in
// lib/fileValidation.js's header applies identically here.

const { sniffMimeType, estimatePdfPageCount } = require('./fileValidation');

const PDF_MIME_TYPE = 'application/pdf';

/**
 * Full validation pass for an uploaded PYQ source PDF buffer.
 * @param {Buffer} buffer
 * @param {{ maxBytes: number, maxPdfPages: number }} limits
 * @returns {{ ok: true, mimeType: string, pageCount: number|null } | { ok: false, code: string, message: string }}
 */
function validatePyqSourceDocument(buffer, limits) {
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
  if (mimeType !== PDF_MIME_TYPE) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Unsupported file type. PYQ source documents must be a PDF.',
    };
  }

  // Same "unknown page count is allowed through, not rejected" reasoning as
  // lib/fileValidation.js's estimatePdfPageCount — this is a cost/sanity
  // guard against a mis-uploaded, implausibly huge file, not a correctness
  // gate, and a false rejection would block a legitimate paper for no reason.
  const pageCount = estimatePdfPageCount(buffer);
  if (pageCount !== null && pageCount > limits.maxPdfPages) {
    return {
      ok: false,
      code: 'PDF_TOO_MANY_PAGES',
      message: `This PDF has too many pages (estimated ${pageCount}). Maximum is ${limits.maxPdfPages} pages.`,
    };
  }

  return { ok: true, mimeType, pageCount };
}

module.exports = { validatePyqSourceDocument };
