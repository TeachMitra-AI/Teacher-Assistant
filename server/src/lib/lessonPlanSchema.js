// Lesson Plan document shape and validation.
// Not a generateAssessment format: quizzes, worksheets, homework and exit tickets are all questions plus an answer
// key, which is why they share assessmentDocumentSchema. A lesson plan is ten named prose sections, and making it
// a format would force every consumer of that schema (renderer, AI-assist actions, the client's answer-key split)
// to handle a document with no questions. It gets its own schema, prompt, renderer and endpoint, and shares the
// generation machinery (retry loop, LaTeX guard).
// The structure is the standard Indian government-school format (NCERT / B.Ed / DIET). The section names are fixed
// vocabulary, since a head teacher recognises the format by its headings.
const { z } = require('zod');

const { normalizeMathText } = require('./assessmentSchema');

// Presentation is the distinctive part of the format: a two-column walk-through with teacher action beside student
// action. The pairing is enforced in the schema rather than left to the model's prose.
const presentationStepSchema = z
  .object({
    teacherActivity: z.string().trim().min(1, 'Each presentation step needs a teacher activity.'),
    studentActivity: z.string().trim().min(1, 'Each presentation step needs a student activity.'),
  })
  .strict();

const nonEmptyList = (min, max, what) =>
  z
    .array(z.string().trim().min(1, `${what} entries cannot be empty.`))
    .min(min, `A lesson plan needs at least ${min} ${what}.`)
    .max(max, `Too many ${what} — a lesson plan a teacher can actually use stays under ${max}.`);

const lessonPlanDocumentSchema = z
  .object({
    // Phrased as learning OUTCOMES ("students will be able to…"), NCF/NEP
    // aligned. The prompt asks for that phrasing; this only bounds the count.
    learningObjectives: nonEmptyList(2, 6, 'learning objectives'),
    previousKnowledge: nonEmptyList(1, 5, 'previous knowledge points'),
    // Bounded low: a plan needing nine materials can't be run tomorrow morning.
    teachingLearningMaterial: nonEmptyList(1, 6, 'teaching learning materials'),
    introduction: z.string().trim().min(1, 'The introduction cannot be empty.'),
    presentation: z
      .array(presentationStepSchema)
      .min(3, 'A lesson plan needs at least 3 presentation steps.')
      .max(10, 'More than 10 presentation steps is a syllabus, not a lesson.'),
    // Nothing else in the product produces this. A teacher copies it onto the
    // board as-is, so it is a single block of text, not a list.
    blackboardSummary: z.string().trim().min(1, 'The blackboard summary cannot be empty.'),
    differentiation: nonEmptyList(1, 5, 'differentiation notes'),
    recapitulation: nonEmptyList(2, 6, 'recapitulation questions'),
    homeAssignment: z.string().trim().min(1, 'The home assignment cannot be empty.'),
  })
  .strict();

/**
 * Applies the same LaTeX repair as the assessment path to every text field of a raw lesson plan, since it
 * carries maths and reaches the same KaTeX renderer. Tolerates any malformed shape (schema validation rejects
 * those) and mirrors normalizeAssessmentMath's contract.
 */
function normalizeLessonPlanMath(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;

  const str = (v) => (typeof v === 'string' ? normalizeMathText(v) : v);
  const list = (v) => (Array.isArray(v) ? v.map(str) : v);

  const out = { ...raw };
  out.learningObjectives = list(out.learningObjectives);
  out.previousKnowledge = list(out.previousKnowledge);
  out.teachingLearningMaterial = list(out.teachingLearningMaterial);
  out.introduction = str(out.introduction);
  out.blackboardSummary = str(out.blackboardSummary);
  out.differentiation = list(out.differentiation);
  out.recapitulation = list(out.recapitulation);
  out.homeAssignment = str(out.homeAssignment);

  if (Array.isArray(out.presentation)) {
    out.presentation = out.presentation.map((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
      return {
        ...step,
        teacherActivity: str(step.teacherActivity),
        studentActivity: str(step.studentActivity),
      };
    });
  }

  return out;
}

/**
 * Every text field of a lesson plan, flattened, so the LaTeX guard can be applied without knowing this document's shape.
 * @param {object} doc
 * @returns {Array<{path: string, value: string}>}
 */
function lessonPlanTextFields(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const fields = [];

  const pushStr = (path, v) => {
    if (typeof v === 'string') fields.push({ path, value: v });
  };
  const pushList = (path, v) => {
    if (Array.isArray(v)) v.forEach((item, i) => pushStr(`${path}[${i}]`, item));
  };

  pushList('learningObjectives', doc.learningObjectives);
  pushList('previousKnowledge', doc.previousKnowledge);
  pushList('teachingLearningMaterial', doc.teachingLearningMaterial);
  pushStr('introduction', doc.introduction);
  pushStr('blackboardSummary', doc.blackboardSummary);
  pushList('differentiation', doc.differentiation);
  pushList('recapitulation', doc.recapitulation);
  pushStr('homeAssignment', doc.homeAssignment);

  if (Array.isArray(doc.presentation)) {
    doc.presentation.forEach((step, i) => {
      if (!step || typeof step !== 'object') return;
      pushStr(`presentation[${i}].teacherActivity`, step.teacherActivity);
      pushStr(`presentation[${i}].studentActivity`, step.studentActivity);
    });
  }

  return fields;
}

/**
 * Writes the LaTeX guard's repaired values back into `doc` in place, keyed by the paths lessonPlanTextFields
 * produced (the two share a path grammar, so they live together). A path that no longer resolves is ignored;
 * schema validation catches a half-applied repair.
 *
 * @param {object} doc mutated in place
 * @param {Record<string, string>} repaired
 */
function applyRepairedFields(doc, repaired) {
  if (!doc || typeof doc !== 'object') return doc;

  for (const [path, value] of Object.entries(repaired)) {
    // "presentation[0].teacherActivity" | "learningObjectives[2]" | "introduction"
    const m = /^([a-zA-Z]+)(?:\[(\d+)\])?(?:\.([a-zA-Z]+))?$/.exec(path);
    if (!m) continue;
    const [, key, indexRaw, subKey] = m;

    if (indexRaw === undefined) {
      if (typeof doc[key] === 'string') doc[key] = value;
      continue;
    }

    const arr = doc[key];
    if (!Array.isArray(arr)) continue;
    const i = Number(indexRaw);

    if (subKey === undefined) {
      if (typeof arr[i] === 'string') arr[i] = value;
    } else if (arr[i] && typeof arr[i] === 'object' && typeof arr[i][subKey] === 'string') {
      arr[i][subKey] = value;
    }
  }

  return doc;
}

module.exports = {
  lessonPlanDocumentSchema,
  normalizeLessonPlanMath,
  lessonPlanTextFields,
  applyRepairedFields,
};
