import { describe, expect, test } from 'vitest';
import {
  ARTIFACT_META,
  BUILDABLE_ARTIFACTS,
  artifactTitle,
  buildableFrom,
  generationInputFor,
} from './classroom';
import type { ClassroomPlan } from '../types';

const plan = (over: Partial<ClassroomPlan> = {}): ClassroomPlan => ({
  topic: 'Fractions',
  grade: 'Class 3-5',
  subject: 'Mathematics',
  language: 'en',
  artifacts: ['lesson_plan', 'worksheet', 'quiz', 'homework', 'exit_ticket'],
  ...over,
});

describe('buildableFrom', () => {
  // The single most important behaviour in this module. The planner offers all
  // five artifacts by design; only some are implemented. A card for an artifact
  // we cannot generate would sit at "Creating…" forever.
  test('drops artifacts that cannot be generated yet', () => {
    expect(buildableFrom(plan())).toEqual(['worksheet', 'quiz', 'exit_ticket']);
  });

  test('preserves the planner order for the ones that survive', () => {
    expect(buildableFrom(plan({ artifacts: ['quiz', 'worksheet'] }))).toEqual(['quiz', 'worksheet']);
  });

  test('a plan of only unbuildable artifacts yields nothing, not a broken card', () => {
    expect(buildableFrom(plan({ artifacts: ['lesson_plan', 'homework'] }))).toEqual([]);
  });

  test('every buildable artifact has generation config and display metadata', () => {
    for (const artifact of BUILDABLE_ARTIFACTS) {
      expect(generationInputFor(artifact, plan())).not.toBeNull();
      expect(ARTIFACT_META[artifact]?.label).toBeTruthy();
    }
  });

  test('every artifact — buildable or not — has display metadata, so P4-P6 cannot forget it', () => {
    for (const artifact of plan().artifacts) {
      expect(ARTIFACT_META[artifact]?.label).toBeTruthy();
      expect(ARTIFACT_META[artifact]?.hint).toBeTruthy();
    }
  });
});

describe('generationInputFor', () => {
  test('carries the merged plan through unchanged — precedence is not re-decided here', () => {
    const input = generationInputFor('quiz', plan({ grade: 'Class 6-8', subject: 'Science' }))!;
    expect(input).toMatchObject({
      format: 'quiz',
      topic: 'Fractions',
      grade: 'Class 6-8',
      subject: 'Science',
      language: 'en',
    });
  });

  test('empty grade/subject become undefined rather than empty strings', () => {
    const input = generationInputFor('quiz', plan({ grade: '', subject: '' }))!;
    expect(input.grade).toBeUndefined();
    expect(input.subject).toBeUndefined();
  });

  // Five documents of identical length would look machine-made. A worksheet a
  // class works through is not the same size as a quiz.
  test('artifacts differ in shape, not just in label', () => {
    const worksheet = generationInputFor('worksheet', plan())!;
    const quiz = generationInputFor('quiz', plan())!;
    expect(worksheet.format).toBe('worksheet');
    expect(quiz.format).toBe('quiz');
    expect(worksheet.questionType).not.toBe(quiz.questionType);
  });

  test('an exit ticket is materially shorter than a quiz, not just relabelled', () => {
    const exit = generationInputFor('exit_ticket', plan())!;
    const quiz = generationInputFor('quiz', plan())!;
    expect(exit.questionCount).toBeLessThan(quiz.questionCount);
    expect(exit.questionCount).toBeLessThanOrEqual(3);
  });

  test('an unbuildable artifact returns null instead of a malformed request', () => {
    expect(generationInputFor('lesson_plan', plan())).toBeNull();
    expect(generationInputFor('homework', plan())).toBeNull();
  });

  test('question counts stay inside the server-validated bounds (3-30)', () => {
    for (const artifact of BUILDABLE_ARTIFACTS) {
      const { questionCount } = generationInputFor(artifact, plan())!;
      expect(questionCount).toBeGreaterThanOrEqual(3);
      expect(questionCount).toBeLessThanOrEqual(30);
    }
  });
});

describe('artifactTitle', () => {
  test('matches the Generator\'s "Kind: Topic (Grade)" shape', () => {
    expect(artifactTitle('quiz', plan())).toBe('Quiz: Fractions (Class 3-5)');
  });

  test('omits the grade when there is none', () => {
    expect(artifactTitle('worksheet', plan({ grade: '' }))).toBe('Worksheet: Fractions');
  });

  test('a missing topic still produces a usable title', () => {
    expect(artifactTitle('quiz', plan({ topic: '   ', grade: '' }))).toBe('Quiz: Untitled');
  });

  test('stays within the 200-character server limit', () => {
    expect(artifactTitle('quiz', plan({ topic: 'x'.repeat(400) })).length).toBeLessThanOrEqual(200);
  });
});
