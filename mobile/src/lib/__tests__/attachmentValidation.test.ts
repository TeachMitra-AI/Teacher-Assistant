// Mirrors client/src/lib/attachmentValidation.test.ts — same cases, adapted
// to the {size, mimeType} PickableFile shape (no DOM File in RN). The web
// suite's "rejects an empty file" case is deliberately NOT ported — see
// validateAttachmentFile's own doc comment for why a zero/unreported size is
// not treated as "empty" on this platform.
import { attachmentKind, validateAttachmentFile, validateNewAttachments, type PickableFile } from '../attachmentValidation';
import { MAX_ATTACHMENT_SIZE_MB, MAX_ATTACHMENTS_COUNT, MAX_ATTACHMENTS_TOTAL_SIZE_MB } from '../../config';

function makeFile(name: string, mimeType: string, size: number): PickableFile & { name: string } {
  return { name, mimeType, size };
}

describe('attachmentKind', () => {
  it('maps application/pdf to "pdf"', () => {
    expect(attachmentKind('application/pdf')).toBe('pdf');
  });

  it('maps any image/* mimeType to "image"', () => {
    expect(attachmentKind('image/jpeg')).toBe('image');
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('image/webp')).toBe('image');
  });

  it('returns null for anything else', () => {
    expect(attachmentKind('application/msword')).toBeNull();
    expect(attachmentKind('text/plain')).toBeNull();
  });
});

describe('validateAttachmentFile', () => {
  it('accepts a small JPEG', () => {
    expect(validateAttachmentFile(makeFile('question.jpg', 'image/jpeg', 1024))).toEqual({ ok: true });
  });

  it('accepts a PDF right at the size boundary', () => {
    const file = makeFile('chapter.pdf', 'application/pdf', MAX_ATTACHMENT_SIZE_MB * 1024 * 1024);
    expect(validateAttachmentFile(file)).toEqual({ ok: true });
  });

  it('rejects a file over the size cap', () => {
    const file = makeFile('big.jpg', 'image/jpeg', MAX_ATTACHMENT_SIZE_MB * 1024 * 1024 + 1);
    const result = validateAttachmentFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('too large');
  });

  it('rejects an unsupported mimeType (e.g. a DOCX)', () => {
    const file = makeFile('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024);
    const result = validateAttachmentFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Unsupported');
  });
});

describe('validateNewAttachments', () => {
  it('accepts multiple valid files of mixed types with no existing attachments', () => {
    const files = [makeFile('a.jpg', 'image/jpeg', 1024), makeFile('b.png', 'image/png', 1024), makeFile('c.pdf', 'application/pdf', 1024)];
    const result = validateNewAttachments([], files);
    expect(result.accepted).toEqual(files);
    expect(result.error).toBeNull();
  });

  it('drops invalid files (wrong type / too large) but keeps the valid ones, with a combined error message', () => {
    const good = makeFile('a.jpg', 'image/jpeg', 1024);
    const badType = makeFile('b.docx', 'application/msword', 1024);
    const badSize = makeFile('c.jpg', 'image/jpeg', MAX_ATTACHMENT_SIZE_MB * 1024 * 1024 + 1);
    const result = validateNewAttachments([], [good, badType, badSize]);
    expect(result.accepted).toEqual([good]);
    expect(result.error).toContain("2 files weren't added");
  });

  it('accepts files up to MAX_ATTACHMENTS_COUNT and drops the rest, counting files already in the tray', () => {
    const existingSizes = Array(MAX_ATTACHMENTS_COUNT - 1).fill(1024); // one slot free
    const newFiles = [makeFile('a.jpg', 'image/jpeg', 1024), makeFile('b.jpg', 'image/jpeg', 1024)];
    const result = validateNewAttachments(existingSizes, newFiles);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(newFiles[0]); // earliest-picked wins
    expect(result.error).toContain(`up to ${MAX_ATTACHMENTS_COUNT} files`);
  });

  it('rejects new files once the combined size would exceed MAX_ATTACHMENTS_TOTAL_SIZE_MB, even though each is individually within the per-file cap', () => {
    const totalCapBytes = MAX_ATTACHMENTS_TOTAL_SIZE_MB * 1024 * 1024;
    const existingSizes = [totalCapBytes - 1024]; // 1KB of room left
    const newFile = makeFile('a.jpg', 'image/jpeg', 2048); // fits per-file cap, not the remaining room
    const result = validateNewAttachments(existingSizes, [newFile]);
    expect(result.accepted).toEqual([]);
    expect(result.error).toContain('combined limit');
  });

  it('returns no error when every file is accepted cleanly', () => {
    const result = validateNewAttachments([], [makeFile('a.jpg', 'image/jpeg', 1024)]);
    expect(result.error).toBeNull();
  });
});
