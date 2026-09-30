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
  savedArtifactIds,
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
  // Every artifact the planner can propose is buildable, so nothing is dropped from a full plan. The filter still keeps a
  // card off screen if the planner returns a value this client doesn't know.
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

  // Two generation paths: the four question-shaped artifacts need a GENERATION_CONFIG row; lesson_plan has none because it
  // uses another endpoint.
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

  // Five documents of identical length would look machine-made.
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

  // Homework and worksheet are the closest pair; if they ever generate the same request, a teacher setting homework silently
  // gets a worksheet.
  test('homework is a shorter set than a worksheet, not the same request relabelled', () => {
    const homework = generationInputFor('homework', plan())!;
    const worksheet = generationInputFor('worksheet', plan())!;
    expect(homework.format).toBe('homework');
    expect(homework.questionCount).toBeLessThan(worksheet.questionCount);
  });

  // Ordering the whole set: an exit ticket is a two-minute check, homework an evening's practice, a worksheet a lesson.
  test('the three practice artifacts are ordered by how long they take', () => {
    const count = (a: Parameters<typeof generationInputFor>[0]) =>
      generationInputFor(a, plan())!.questionCount;
    expect(count('exit_ticket')).toBeLessThan(count('homework'));
    expect(count('homework')).toBeLessThan(count('worksheet'));
  });

  // lesson_plan is buildable but not through this endpoint; returning null stops it being generated as a worksheet with no questions.
  test('returns null for lesson_plan — it is not an assessment', () => {
    expect(generationInputFor('lesson_plan', plan())).toBeNull();
  });

  test('question counts stay inside the server-validated bounds (3-30)', () => {
    // lesson_plan has no question count; it isn't an assessment.
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

// Batched generation: the four question-shaped artifacts travel in one request instead of 7 Gemini calls per question.
describe('assessmentSetInputFor', () => {
  test('batches every question-shaped artifact, excluding the lesson plan', () => {
    const input = assessmentSetInputFor(plan())!;
    expect(input.items.map((i) => i.format)).toEqual(['worksheet', 'quiz', 'homework', 'exit_ticket']);
  });

  // Shared context is sent once; per-artifact settings ride in items.
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
  // The queue maps a batched result to its card by format; a wrong mapping puts the quiz in the homework card.
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

describe('savedArtifactIds', () => {
  // Shape the card writes on save.
  const saved = (id: string, format: string, source = 'classroom_mode') => ({
    id,
    structured: JSON.stringify({ format, topic: 'Fractions', source }),
  });

  test('maps each classroom-mode resource to its artifact', () => {
    const ids = savedArtifactIds([
      saved('r1', 'quiz'),
      saved('r2', 'homework'),
    ] as never);
    expect(ids.quiz).toBe('r1');
    expect(ids.homework).toBe('r2');
    expect(ids.worksheet).toBeUndefined();
  });

  // A Generator-saved resource has the same `format` key but a different source; counting it would mark a card Saved.
  test('ignores resources that did not come from classroom mode', () => {
    const ids = savedArtifactIds([saved('r1', 'quiz', 'generator')] as never);
    expect(ids.quiz).toBeUndefined();
  });

  test('ignores resources with no or unparseable structured data', () => {
    const ids = savedArtifactIds([
      { id: 'r1', structured: null },
      { id: 'r2', structured: 'not json' },
      { id: 'r3', structured: JSON.stringify({ source: 'classroom_mode' }) },
      { id: 'r4', structured: JSON.stringify({ format: 'nonsense', source: 'classroom_mode' }) },
    ] as never);
    expect(Object.keys(ids)).toHaveLength(0);
  });

  // Newest first, so a duplicate save resolves to the most recent copy.
  test('keeps the first match when an artifact was saved twice', () => {
    const ids = savedArtifactIds([saved('newest', 'quiz'), saved('oldest', 'quiz')] as never);
    expect(ids.quiz).toBe('newest');
  });

  test('an empty library yields an empty map', () => {
    expect(savedArtifactIds([])).toEqual({});
  });
});
