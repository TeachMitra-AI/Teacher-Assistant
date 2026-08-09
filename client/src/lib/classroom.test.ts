import { describe, expect, test } from 'vitest';
import {
  ARTIFACT_META,
  BUILDABLE_ARTIFACTS,
  artifactTitle,
  buildableFrom,
  generationInputFor,
  lessonPlanInputFor,
  assessmentSetInputFor,
  artifactForFormat,
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
  // As of P6 every artifact the planner can propose is buildable, so nothing
  // is dropped from a full plan. The filter still matters: it is what keeps a
  // card off the screen if the planner ever returns a value this client does
  // not know, and it is the seam a future artifact goes through.
  test('a full plan builds every artifact, in the planner order', () => {
    expect(buildableFrom(plan())).toEqual(['lesson_plan', 'worksheet', 'quiz', 'homework', 'exit_ticket']);
  });

  test('drops an artifact this client does not recognise', () => {
    const unknown = ['worksheet', 'debate_activity', 'quiz'] as unknown as ClassroomPlan['artifacts'];
    expect(buildableFrom(plan({ artifacts: unknown }))).toEqual(['worksheet', 'quiz']);
  });

  test('preserves the planner order for the ones that survive', () => {
    expect(buildableFrom(plan({ artifacts: ['quiz', 'worksheet'] }))).toEqual(['quiz', 'worksheet']);
  });

  test('a plan with no artifacts yields nothing, not a broken card', () => {
    expect(buildableFrom(plan({ artifacts: [] }))).toEqual([]);
  });

  // Two generation paths since P6, so "has config" splits: the four
  // question-shaped artifacts need a GENERATION_CONFIG row, and lesson_plan
  // deliberately has none because it does not use that endpoint.
  test('every buildable artifact has display metadata and a working request builder', () => {
    for (const artifact of BUILDABLE_ARTIFACTS) {
      expect(ARTIFACT_META[artifact]?.label).toBeTruthy();
      if (artifact === 'lesson_plan') {
        expect(generationInputFor(artifact, plan())).toBeNull();
        expect(lessonPlanInputFor(plan()).topic).toBe('Fractions');
      } else {
        expect(generationInputFor(artifact, plan())).not.toBeNull();
      }
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

  // Homework and worksheet are the closest pair in the product — both are
  // practice questions with a teacher answer key. If they ever generate the
  // same request, a teacher setting homework silently gets a worksheet, which
  // is the failure this test exists to catch.
  test('homework is a shorter set than a worksheet, not the same request relabelled', () => {
    const homework = generationInputFor('homework', plan())!;
    const worksheet = generationInputFor('worksheet', plan())!;
    expect(homework.format).toBe('homework');
    expect(homework.questionCount).toBeLessThan(worksheet.questionCount);
  });

  // Ordering the whole set at once: an exit ticket is a two-minute check, a
  // homework is an evening's practice, a worksheet fills a lesson.
  test('the three practice artifacts are ordered by how long they take', () => {
    const count = (a: Parameters<typeof generationInputFor>[0]) =>
      generationInputFor(a, plan())!.questionCount;
    expect(count('exit_ticket')).toBeLessThan(count('homework'));
    expect(count('homework')).toBeLessThan(count('worksheet'));
  });

  // lesson_plan IS buildable, but not through this endpoint. Returning null
  // rather than a half-filled assessment request is what stops a lesson plan
  // being generated as a worksheet with no questions.
  test('returns null for lesson_plan — it is not an assessment', () => {
    expect(generationInputFor('lesson_plan', plan())).toBeNull();
  });

  test('question counts stay inside the server-validated bounds (3-30)', () => {
    // lesson_plan has no question count — it is not an assessment.
    for (const artifact of BUILDABLE_ARTIFACTS.filter((a) => a !== 'lesson_plan')) {
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

// Batched generation (2026-08-07). Classroom Mode cost 7 Gemini calls per
// teacher question; the free tier allows 20/minute. The four question-shaped
// artifacts now travel in one request.
describe('assessmentSetInputFor', () => {
  test('batches every question-shaped artifact, excluding the lesson plan', () => {
    const input = assessmentSetInputFor(plan())!;
    expect(input.items.map((i) => i.format)).toEqual(['worksheet', 'quiz', 'homework', 'exit_ticket']);
  });

  // The whole token saving: shared context is sent once, per-artifact settings
  // ride along in items.
  test('sends the shared context once, not per artifact', () => {
    const input = assessmentSetInputFor(plan())!;
    expect(input.topic).toBe('Fractions');
    expect(input.grade).toBe('Class 3-5');
    for (const item of input.items) {
      expect(item).not.toHaveProperty('topic');
      expect(item).not.toHaveProperty('grade');
    }
  });

  test('each artifact keeps its own shape inside the batch', () => {
    const byFormat = Object.fromEntries(assessmentSetInputFor(plan())!.items.map((i) => [i.format, i]));
    expect(byFormat.quiz.questionCount).toBe(10);
    expect(byFormat.worksheet.questionCount).toBe(8);
    expect(byFormat.homework.questionCount).toBe(6);
    expect(byFormat.exit_ticket.questionCount).toBe(3);
    expect(byFormat.exit_ticket.difficulty).toBe('easy');
  });

  test('returns null when a plan has nothing to batch, so no request is sent', () => {
    expect(assessmentSetInputFor(plan({ artifacts: ['lesson_plan'] }))).toBeNull();
    expect(assessmentSetInputFor(plan({ artifacts: [] }))).toBeNull();
  });

  test('empty grade and subject are omitted rather than sent blank', () => {
    const input = assessmentSetInputFor(plan({ grade: '', subject: '' }))!;
    expect(input.grade).toBeUndefined();
    expect(input.subject).toBeUndefined();
  });
});

describe('artifactForFormat', () => {
  // The queue maps a batched result back to its card by format. If this
  // mapping is wrong a teacher silently gets the quiz in the homework card.
  test('maps every batched format back to its artifact', () => {
    expect(artifactForFormat('worksheet')).toBe('worksheet');
    expect(artifactForFormat('quiz')).toBe('quiz');
    expect(artifactForFormat('homework')).toBe('homework');
    expect(artifactForFormat('exit_ticket')).toBe('exit_ticket');
  });

  test('round-trips every item the batch builder produces', () => {
    for (const item of assessmentSetInputFor(plan())!.items) {
      expect(artifactForFormat(item.format)).not.toBeNull();
    }
  });
});
