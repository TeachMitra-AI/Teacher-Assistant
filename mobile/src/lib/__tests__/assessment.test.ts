import { splitAnswerKey, stripAssessmentPreamble } from '../assessment';

describe('splitAnswerKey', () => {
  it('splits questions from a trailing "## Answer Key" section', () => {
    const md = '## Questions\n\n1. What is 2+2?\n\n## Answer Key\n\n1. 4';
    const result = splitAnswerKey(md);
    expect(result.hasAnswerKey).toBe(true);
    expect(result.questions).toBe('## Questions\n\n1. What is 2+2?');
    expect(result.answerKey).toBe('## Answer Key\n\n1. 4');
  });

  it('recognizes "Teacher Answer Key" and "Answer Keys" variants, case-insensitively', () => {
    expect(splitAnswerKey('Q\n\n## teacher answer key\n\nA').hasAnswerKey).toBe(true);
    expect(splitAnswerKey('Q\n\n### ANSWER KEYS\n\nA').hasAnswerKey).toBe(true);
  });

  it('returns hasAnswerKey false and the full text as questions when no heading is found', () => {
    const md = '## Questions\n\n1. No key here.';
    const result = splitAnswerKey(md);
    expect(result.hasAnswerKey).toBe(false);
    expect(result.answerKey).toBe('');
    expect(result.questions).toBe(md);
  });

  it('handles null/undefined input as empty text', () => {
    expect(splitAnswerKey(undefined as unknown as string)).toEqual({ questions: '', answerKey: '', hasAnswerKey: false });
  });
});

describe('stripAssessmentPreamble', () => {
  it('removes a generated title + metadata preamble before the first "##" heading', () => {
    const md = '# Science Quiz: Photosynthesis\n\n**Grade:** Class 6-8\n**Subject:** Science\n\n## Instructions\n\nAnswer all.';
    expect(stripAssessmentPreamble(md)).toBe('## Instructions\n\nAnswer all.');
  });

  it('leaves hand-edited content unchanged when it does not match the generated shape', () => {
    const md = 'Just some notes.\n\n## Instructions\n\nAnswer all.';
    expect(stripAssessmentPreamble(md)).toBe(md);
  });

  it('handles empty input', () => {
    expect(stripAssessmentPreamble('')).toBe('');
  });
});
