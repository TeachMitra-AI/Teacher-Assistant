// Lesson Plan document shape and validation (Classroom Mode P6).
//
// WHY THIS IS NOT A generateAssessment FORMAT (the P6 endpoint decision, D21):
// worksheet/quiz/homework/exit_ticket are all the same document — questions,
// options, an answer key — which is exactly why they are FORMATS of one
// endpoint and share assessmentDocumentSchema. A lesson plan has no questions
// and no answer key; it is ten named prose sections. Making it a fourth
// "format" would mean assessmentDocumentSchema could no longer require
// `questions`, and every layer that consumes it (the renderer, the AI-assist
// actions, the client's answer-key split) would need a branch for a document
// with none. That is the ternary sprawl FORMAT_META was introduced to remove.
// It gets its own schema, prompt, renderer and endpoint, and shares the
// generation *machinery* (retry loop, LaTeX guard) rather than the shape.
//
// STRUCTURE (D15): the standard Indian government-school format teachers are
// trained on (NCERT / B.Ed / DIET), NOT a generic Western lesson plan. Section
// NAMES are load-bearing — a head teacher recognises the format by its
// headings, so these are fixed vocabulary, not suggestions.
const { z } = require('zod');

const { normalizeMathText } = require('./assessmentSchema');

// Presentation is the distinctive part of the Indian format: a two-column
// walk-through of the lesson, teacher action beside the matching student
// action. A flat list of "steps" would lose exactly what makes the format
// recognisable, so the pairing is enforced in the schema rather than left to
// the model's prose.
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
    // The section that decides whether this is usable in a government school.
    // Bounded low deliberately: a plan needing nine materials is a plan a
    // teacher cannot run tomorrow morning.
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
 * Applies the same LaTeX repair the assessment path uses to every text field
 * of a raw (pre-validation) lesson plan. A lesson plan carries maths in its
 * objectives, blackboard summary and recap questions just as a worksheet does,
 * and it reaches the same KaTeX renderer — so it needs the same repair, not a
 * second implementation of it.
 *
 * Tolerates any malformed shape; schema validation right after is what rejects
 * those. Mirrors normalizeAssessmentMath's contract exactly.
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
 * Every text field of a lesson plan, flattened — so the LaTeX guard can be
 * applied uniformly without latexGuard needing to know this document's shape.
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
 * Writes the LaTeX guard's repaired values back into `doc`, in place, keyed by
 * the same paths lessonPlanTextFields produced. Paired with that function: the
 * two must agree on the path grammar, which is why they live together here
 * rather than being split across the caller.
 *
 * Silently ignores a path that no longer resolves — the guard never invents
 * paths, so that can only mean the document changed underneath, and a
 * half-applied repair is caught by schema validation immediately after.
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
