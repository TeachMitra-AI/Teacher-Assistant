const {
  ALLOWED_MIME_TYPES,
  sniffMimeType,
  estimatePdfPageCount,
  validateAttachment,
  validateAttachmentBatch,
} = require('../../src/lib/fileValidation');

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // chunk size, irrelevant here
  Buffer.from('WEBP', 'latin1'),
]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n', 'latin1');

function pdfWithPages(count) {
  let body = '%PDF-1.4\n';
  for (let i = 0; i < count; i++) {
    body += `${i} 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n`;
  }
  return Buffer.from(body, 'latin1');
}

describe('fileValidation.sniffMimeType', () => {
  test('recognizes a real JPEG signature', () => {
    expect(sniffMimeType(JPEG_BYTES)).toBe('image/jpeg');
  });

  test('recognizes a real PNG signature', () => {
    expect(sniffMimeType(PNG_BYTES)).toBe('image/png');
  });

  test('recognizes a real WEBP signature (RIFF + WEBP tag)', () => {
    expect(sniffMimeType(WEBP_BYTES)).toBe('image/webp');
  });

  test('rejects a RIFF container that is not WEBP (e.g. a WAV file)', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
    ]);
    expect(sniffMimeType(wav)).toBeNull();
  });

  test('recognizes a real PDF signature', () => {
    expect(sniffMimeType(PDF_BYTES)).toBe('application/pdf');
  });

  test('rejects a spoofed file — declared image, actual bytes are neither an image nor a PDF', () => {
    const fakeExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ" (PE executable header)
    expect(sniffMimeType(fakeExe)).toBeNull();
  });

  test('rejects an empty buffer', () => {
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  test('rejects a buffer shorter than any signature', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  test('every entry in ALLOWED_MIME_TYPES is reachable by sniffMimeType', () => {
    const samples = { 'image/jpeg': JPEG_BYTES, 'image/png': PNG_BYTES, 'image/webp': WEBP_BYTES, 'application/pdf': PDF_BYTES };
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(sniffMimeType(samples[mime])).toBe(mime);
    }
  });
});

describe('fileValidation.estimatePdfPageCount', () => {
  test('counts /Type /Page markers', () => {
    expect(estimatePdfPageCount(pdfWithPages(5))).toBe(5);
  });

  test('returns null when no marker is found (unknown structure) rather than 0', () => {
    expect(estimatePdfPageCount(Buffer.from('%PDF-1.4\nno page markers here', 'latin1'))).toBeNull();
  });

  test('does not confuse /Type /Pages (the page-tree root) with /Type /Page', () => {
    const body = '%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 3 >>\nendobj\n';
    expect(estimatePdfPageCount(Buffer.from(body, 'latin1'))).toBeNull();
  });
});

describe('fileValidation.validateAttachment', () => {
  const limits = { maxBytes: 1024 * 1024, maxPdfPages: 10 };

  test('accepts a valid JPEG within limits', () => {
    const result = validateAttachment(JPEG_BYTES, limits);
    expect(result).toEqual({ ok: true, mimeType: 'image/jpeg' });
  });

  test('accepts a valid PDF within the page limit', () => {
    const result = validateAttachment(pdfWithPages(3), limits);
    expect(result).toEqual({ ok: true, mimeType: 'application/pdf' });
  });

  test('rejects an oversized file with FILE_TOO_LARGE', () => {
    const big = Buffer.concat([JPEG_BYTES, Buffer.alloc(limits.maxBytes)]);
    const result = validateAttachment(big, limits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FILE_TOO_LARGE');
  });

  test('rejects an unrecognized file type with UNSUPPORTED_FILE_TYPE', () => {
    const result = validateAttachment(Buffer.from('not a real file'), limits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('rejects an empty buffer with EMPTY_FILE', () => {
    const result = validateAttachment(Buffer.alloc(0), limits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('EMPTY_FILE');
  });

  test('rejects a PDF exceeding the page cap with PDF_TOO_MANY_PAGES', () => {
    const result = validateAttachment(pdfWithPages(20), limits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PDF_TOO_MANY_PAGES');
  });

  test('allows a PDF whose page count cannot be estimated (fails open on the cost guard, not the correctness gate)', () => {
    const body = Buffer.from('%PDF-1.4\nno page markers here', 'latin1');
    const result = validateAttachment(body, limits);
    expect(result).toEqual({ ok: true, mimeType: 'application/pdf' });
  });
});

describe('fileValidation.validateAttachmentBatch', () => {
  const batchLimits = { maxBytes: 1024 * 1024, maxPdfPages: 10, maxFiles: 3, maxTotalBytes: 2 * 1024 * 1024 };

  test('accepts a single file (backward-compatible with the original single-file shape)', () => {
    const result = validateAttachmentBatch([JPEG_BYTES], batchLimits);
    expect(result).toEqual({ ok: true, files: [{ mimeType: 'image/jpeg' }] });
  });

  test('accepts multiple files of mixed types, in order', () => {
    const result = validateAttachmentBatch([JPEG_BYTES, PNG_BYTES, PDF_BYTES], batchLimits);
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([{ mimeType: 'image/jpeg' }, { mimeType: 'image/png' }, { mimeType: 'application/pdf' }]);
  });

  test('rejects an empty batch with FILE_REQUIRED', () => {
    const result = validateAttachmentBatch([], batchLimits);
    expect(result).toEqual({ ok: false, code: 'FILE_REQUIRED', message: 'At least one file is required.' });
  });

  test('rejects a batch exceeding the file-count cap with TOO_MANY_FILES, without sniffing any bytes', () => {
    const result = validateAttachmentBatch([JPEG_BYTES, PNG_BYTES, WEBP_BYTES, PDF_BYTES], batchLimits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TOO_MANY_FILES');
  });

  test('rejects a batch whose COMBINED size exceeds maxTotalBytes, even though each file is under the per-file cap', () => {
    const big = (n) => Buffer.concat([JPEG_BYTES, Buffer.alloc(n)]);
    const tight = { ...batchLimits, maxTotalBytes: 1.5 * 1024 * 1024 };
    // Two files, each ~0.9MB (under the 1MB per-file cap) but ~1.8MB combined
    // (over the 1.5MB total cap) — this is exactly the case a per-file cap
    // alone cannot catch.
    const result = validateAttachmentBatch([big(900 * 1024), big(900 * 1024)], tight);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('BATCH_TOO_LARGE');
  });

  test('rejects the WHOLE batch if any single file is invalid, on the first bad file found', () => {
    const spoofed = Buffer.from('not a real file');
    const result = validateAttachmentBatch([JPEG_BYTES, spoofed, PDF_BYTES], batchLimits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('rejects the whole batch if any single file exceeds the per-file size cap', () => {
    const tooBig = Buffer.concat([JPEG_BYTES, Buffer.alloc(batchLimits.maxBytes)]);
    const result = validateAttachmentBatch([JPEG_BYTES, tooBig], batchLimits);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('FILE_TOO_LARGE');
  });
});
