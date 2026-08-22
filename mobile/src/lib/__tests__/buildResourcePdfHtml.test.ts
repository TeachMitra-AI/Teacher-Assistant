import { buildResourcePdfHtml } from '../buildResourcePdfHtml';

const baseInput = {
  title: 'Photosynthesis',
  grade: 'Class 6-8',
  subject: 'Science',
  language: 'en',
  content: '## Instructions\n\nAnswer all.\n\n## Questions\n\n1. What is chlorophyll?\n\n## Answer Key\n\n1. A pigment.',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

describe('buildResourcePdfHtml — non-assessment resource', () => {
  it('renders a plain document header (brand/title/meta/date) plus the formatted content', () => {
    const html = buildResourcePdfHtml({ ...baseInput, type: 'lesson_plan', printMode: 'full' });
    expect(html).toContain('Teacher Assistant');
    expect(html).toContain('<h1 class="doc-title">Photosynthesis</h1>');
    expect(html).toContain('Grade: Class 6-8');
    expect(html).toContain('Subject: Science');
    expect(html).toContain('Language: English');
    expect(html).toContain('Answer all.');
  });

  it('falls back to "Untitled resource" for an empty title', () => {
    const html = buildResourcePdfHtml({ ...baseInput, title: '', type: 'general', printMode: 'full' });
    expect(html).toContain('Untitled resource');
  });
});

describe('buildResourcePdfHtml — assessment resource', () => {
  const examMeta = { schoolName: 'Govt School', maxMarks: '20', showDate: true, date: '12 Aug 2026' };

  it('renders the exam-paper letterhead instead of the plain document header', () => {
    const html = buildResourcePdfHtml({ ...baseInput, type: 'assessment', examMeta, printMode: 'teacher' });
    expect(html).toContain('class="exam-header"');
    expect(html).toContain('Govt School');
    expect(html).toContain('Maximum Marks:</b> 20');
    expect(html).not.toContain('Teacher Assistant');
  });

  it('teacher mode includes the answer key section', () => {
    const html = buildResourcePdfHtml({ ...baseInput, type: 'assessment', examMeta, printMode: 'teacher' });
    expect(html).toContain('A pigment.');
  });

  it('student mode omits the answer key section entirely', () => {
    const html = buildResourcePdfHtml({ ...baseInput, type: 'assessment', examMeta, printMode: 'student' });
    expect(html).not.toContain('A pigment.');
    expect(html).toContain('What is chlorophyll?');
  });

  it('strips the generated title/metadata preamble since the letterhead already presents it', () => {
    const withPreamble = `# Science Quiz: Photosynthesis\n\n**Grade:** Class 6-8\n\n${baseInput.content}`;
    const html = buildResourcePdfHtml({ ...baseInput, content: withPreamble, type: 'assessment', examMeta, printMode: 'teacher' });
    expect(html).not.toContain('Science Quiz: Photosynthesis');
  });
});
