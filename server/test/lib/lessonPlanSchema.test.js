const {
  lessonPlanDocumentSchema,
  normalizeLessonPlanMath,
  lessonPlanTextFields,
  applyRepairedFields,
} = require('../../src/lib/lessonPlanSchema');
const { renderLessonPlanMarkdown, CLASSROOM_TYPE_DIRECTIVES } = require('../../src/lib/lessonPlanPrompt');
const { CLASSROOM_TYPES, DURATIONS, generateLessonPlanSchema } = require('../../src/actions/schemas/generateLessonPlan');

function validPlan(over = {}) {
  return {
    learningObjectives: [
      'Students will be able to identify the numerator of a fraction.',
      'Students will be able to compare two unit fractions.',
    ],
    previousKnowledge: ['Counting whole numbers to 100'],
    teachingLearningMaterial: ['Chalk and blackboard', 'A paper circle'],
    introduction: 'Hold up one roti and ask how two children share it fairly.',
    presentation: [
      { teacherActivity: 'Cut the roti in half', studentActivity: 'Name each part as one half' },
      { teacherActivity: 'Cut a half again', studentActivity: 'Count the four equal parts' },
      { teacherActivity: 'Write the symbols on the board', studentActivity: 'Copy into notebooks' },
    ],
    blackboardSummary: 'Fractions: equal parts of one whole.',
    differentiation: ['Slower learners fold paper; fast finishers write one eighth'],
    recapitulation: ['What is one half of this chalk?', 'Draw a circle and shade one fourth.'],
    homeAssignment: 'Find three things at home divided into equal parts.',
    ...over,
  };
}

describe('lessonPlanDocumentSchema', () => {
  test('accepts a well-formed plan', () => {
    expect(lessonPlanDocumentSchema.safeParse(validPlan()).success).toBe(true);
  });

  // The Presentation pairing is what makes this the Indian format rather than
  // a generic list of steps (D15). A step with only a teacher activity would
  // silently produce a one-column table.
  test('rejects a presentation step missing its student activity', () => {
    const r = lessonPlanDocumentSchema.safeParse(
      validPlan({ presentation: [{ teacherActivity: 'Explain fractions' }] })
    );
    expect(r.success).toBe(false);
  });

  test('rejects a plan with too few presentation steps to be a lesson', () => {
    const r = lessonPlanDocumentSchema.safeParse(
      validPlan({ presentation: [{ teacherActivity: 'a', studentActivity: 'b' }] })
    );
    expect(r.success).toBe(false);
  });

  test('rejects empty required sections', () => {
    for (const field of ['introduction', 'blackboardSummary', 'homeAssignment']) {
      expect(lessonPlanDocumentSchema.safeParse(validPlan({ [field]: '   ' })).success).toBe(false);
    }
  });

  test('rejects an unknown section rather than silently dropping it', () => {
    expect(lessonPlanDocumentSchema.safeParse(validPlan({ homework: 'extra' })).success).toBe(false);
  });

  // A plan needing nine materials is a plan a teacher cannot run tomorrow.
  test('bounds the materials list', () => {
    const many = Array.from({ length: 9 }, (_, i) => `Material ${i}`);
    expect(lessonPlanDocumentSchema.safeParse(validPlan({ teachingLearningMaterial: many })).success).toBe(false);
  });
});

describe('normalizeLessonPlanMath', () => {
  // Same repair the assessment path gets — a lesson plan carries maths in its
  // objectives and blackboard summary and reaches the same KaTeX renderer.
  test('repairs backslash-less LaTeX everywhere it can appear', () => {
    const out = normalizeLessonPlanMath({
      learningObjectives: ['Identify $frac59$'],
      blackboardSummary: 'Write $frac12$ on the board',
      homeAssignment: 'Practise $frac14$',
      presentation: [{ teacherActivity: 'Show $frac13$', studentActivity: 'Copy $frac23$' }],
    });
    expect(out.learningObjectives[0]).toBe('Identify $\\frac59$');
    expect(out.blackboardSummary).toBe('Write $\\frac12$ on the board');
    expect(out.homeAssignment).toBe('Practise $\\frac14$');
    expect(out.presentation[0].teacherActivity).toBe('Show $\\frac13$');
    expect(out.presentation[0].studentActivity).toBe('Copy $\\frac23$');
  });

  test('tolerates malformed shapes without throwing', () => {
    expect(normalizeLessonPlanMath(null)).toBe(null);
    expect(normalizeLessonPlanMath('nope')).toBe('nope');
    expect(normalizeLessonPlanMath({ presentation: 'nope' })).toEqual({ presentation: 'nope' });
    expect(normalizeLessonPlanMath({ presentation: [null, 5] }).presentation).toEqual([null, 5]);
  });
});

describe('lessonPlanTextFields / applyRepairedFields', () => {
  test('round-trips every text field back to where it came from', () => {
    const doc = validPlan();
    const fields = lessonPlanTextFields(doc);
    expect(fields.length).toBeGreaterThan(10);

    // Simulate the guard repairing everything to a marker, then applying it.
    const repaired = Object.fromEntries(fields.map((f) => [f.path, `REPAIRED:${f.value}`]));
    applyRepairedFields(doc, repaired);

    expect(doc.learningObjectives[0]).toMatch(/^REPAIRED:/);
    expect(doc.introduction).toMatch(/^REPAIRED:/);
    expect(doc.presentation[0].teacherActivity).toMatch(/^REPAIRED:/);
    expect(doc.presentation[2].studentActivity).toMatch(/^REPAIRED:/);
    expect(doc.recapitulation[1]).toMatch(/^REPAIRED:/);
  });

  test('ignores a path that no longer resolves instead of throwing', () => {
    const doc = validPlan();
    expect(() =>
      applyRepairedFields(doc, { 'nosuchfield[3].nope': 'x', 'presentation[99].teacherActivity': 'y' })
    ).not.toThrow();
  });
});

describe('renderLessonPlanMarkdown', () => {
  const meta = { topic: 'Fractions', grade: 'Class 4', subject: 'Mathematics', duration: '40 minutes' };

  test('emits every section heading a teacher recognises the format by', () => {
    const md = renderLessonPlanMarkdown(validPlan(), meta);
    for (const heading of [
      '## Learning Objectives',
      '## Previous Knowledge',
      '## Teaching Learning Material (TLM)',
      '## Introduction / Motivation',
      '## Presentation',
      '## Blackboard Summary',
      '## Differentiation',
      '## Recapitulation / Evaluation',
      '## Home Assignment',
    ]) {
      expect(md, `missing ${heading}`).toContain(heading);
    }
  });

  test('renders Presentation as the two-column teacher/student table', () => {
    const md = renderLessonPlanMarkdown(validPlan(), meta);
    expect(md).toContain('| # | Teacher Activity | Student Activity |');
    expect(md).toContain('| 1 | Cut the roti in half | Name each part as one half |');
  });

  // A step containing a pipe would otherwise split into extra columns and
  // silently corrupt every row after it.
  test('escapes a pipe inside a presentation step', () => {
    const md = renderLessonPlanMarkdown(
      validPlan({
        presentation: [
          { teacherActivity: 'Draw a | b on the board', studentActivity: 'Copy it' },
          { teacherActivity: 'x', studentActivity: 'y' },
          { teacherActivity: 'p', studentActivity: 'q' },
        ],
      }),
      meta
    );
    expect(md).toContain('Draw a \\| b on the board');
    // The row must still have exactly 4 UNESCAPED pipes (start, two column
    // separators, end) — the escaped one must not create a fifth column.
    const row = md.split('\n').find((l) => l.includes('Draw a'));
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(4);
  });

  test('omits header fields that are absent rather than printing empty labels', () => {
    const md = renderLessonPlanMarkdown(validPlan(), { topic: 'Fractions', grade: '', subject: '', duration: '' });
    expect(md).toContain('# Lesson Plan: Fractions');
    expect(md).not.toContain('**Class:**');
    expect(md).not.toContain('**Duration:**');
  });
});

describe('generateLessonPlanSchema', () => {
  test('requires a topic and defaults the rest', () => {
    const r = generateLessonPlanSchema.safeParse({ topic: 'Fractions' });
    expect(r.success).toBe(true);
    expect(r.data.duration).toBe('40 minutes');
    expect(r.data.classroomType).toBe('standard');
    expect(r.data.language).toBe('en');
  });

  test('rejects a missing topic', () => {
    expect(generateLessonPlanSchema.safeParse({}).success).toBe(false);
  });

  // A free-text duration is how a 35-minute period gets a 3-hour plan.
  test('rejects a duration outside the school-day set', () => {
    expect(generateLessonPlanSchema.safeParse({ topic: 'x', duration: '3 hours' }).success).toBe(false);
  });

  test('rejects an unknown classroom type', () => {
    expect(generateLessonPlanSchema.safeParse({ topic: 'x', classroomType: 'online' }).success).toBe(false);
  });

  test('rejects unknown keys rather than ignoring them', () => {
    expect(generateLessonPlanSchema.safeParse({ topic: 'x', questionCount: 10 }).success).toBe(false);
  });
});

describe('classroom-type coverage', () => {
  // Mirrors the assessmentFormats boot assertion: a type with no directive
  // generates a generic plan that ignores the teacher's actual room.
  test('every classroom type has a directive', () => {
    for (const type of CLASSROOM_TYPES) {
      expect(CLASSROOM_TYPE_DIRECTIVES[type], type).toBeTruthy();
    }
  });

  test('no two classroom types share a directive', () => {
    const values = CLASSROOM_TYPES.map((t) => CLASSROOM_TYPE_DIRECTIVES[t]);
    expect(new Set(values).size).toBe(CLASSROOM_TYPES.length);
  });

  test('every duration is a plausible single period', () => {
    for (const d of DURATIONS) expect(d).toMatch(/^\d{2} minutes$/);
  });
});
