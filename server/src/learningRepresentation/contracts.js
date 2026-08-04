// Educational Intent taxonomy — AI Learning Representation System, Phase A.
//
// Frozen wire vocabulary for this feature, per the approved ADR
// (docs/learning-representation-system-adr.md, §3). This module is the single
// definition of the taxonomy: what the classifier prompt describes and what
// the parser accepts are both built from the list below, so they cannot drift
// apart — the same discipline server/src/assistant/contracts.js applies to
// the AI Action Router's own intent set.
//
// Seven intents, deliberately non-overlapping (ADR §3 explains the merges
// that got the list this small — e.g. "explain structure" absorbs what were
// three separate, unstably-separable candidates in earlier drafts).
// `no_visualization` is a first-class, frequently-correct outcome, not a
// residual "none of the above" bucket (ADR Product Principle 1).
//
// Deliberately self-contained rather than importing CONFIDENCE_LEVELS from
// assistant/contracts.js: the two features are independent systems that
// happen to share an ordinal-confidence idea, and assistant/contracts.js's
// own header documents this project's preference for a small documented
// duplication over cross-feature coupling when the two are not the same
// system (see its note on the client/server type duplication).

const EDUCATIONAL_INTENTS = Object.freeze([
  Object.freeze({
    id: 'explain_process',
    description: 'The content is a sequence of steps or a cause-effect chain.',
    examples: [
      'Explain the TCP handshake.',
      'How does digestion work?',
      'Explain photosynthesis.',
    ],
  }),
  Object.freeze({
    id: 'compare_concepts',
    description: 'The content contrasts two or more things along shared dimensions.',
    examples: [
      'Compare mitosis and meiosis.',
      'Capitalism vs. socialism.',
      'What is the difference between a compound and a mixture?',
    ],
  }),
  Object.freeze({
    id: 'show_chronology',
    description: 'The content is a sequence of events situated in time.',
    examples: [
      'Timeline of the Mughal Empire.',
      'Key events of World War II.',
      'When did the major events of the French Revolution happen?',
    ],
  }),
  Object.freeze({
    id: 'show_hierarchy',
    description: 'The content is a classification, taxonomy, or parent/child structure.',
    examples: [
      'Classify the animal kingdom.',
      'What is the org structure of a Roman legion?',
      'Show me the branches of the Indian government.',
    ],
  }),
  Object.freeze({
    id: 'explain_structure',
    description:
      'The content is a composition of parts, a spatial arrangement, or how those parts relate — whether the goal is naming parts or understanding how they work together.',
    examples: [
      'Label the human heart.',
      'Parts of a plant cell.',
      'How does a car engine work?',
    ],
  }),
  Object.freeze({
    id: 'show_quantitative_data',
    description: 'The content is numeric and its meaning depends on magnitude, trend, or distribution.',
    examples: [
      "Show India's population growth over the last 50 years.",
      'Graph y = x squared.',
      "What's the trend in global average temperature over the last century?",
    ],
  }),
  Object.freeze({
    id: 'no_visualization',
    description:
      'The content is definitional, opinion-based, a single fact, or otherwise has no structure a non-prose representation would clarify.',
    examples: [
      'What year was Mahatma Gandhi born?',
      'Is this a good essay topic for Class 8?',
      'Define photosynthesis in one line.',
    ],
  }),
]);

const EDUCATIONAL_INTENT_IDS = Object.freeze(EDUCATIONAL_INTENTS.map((intent) => intent.id));

/**
 * Model-reported confidence. Ordinal, not a float — LLMs are poorly
 * calibrated at self-reported numeric confidence but adequately ordered at
 * categorical confidence. Mirrors assistant/contracts.js's CONFIDENCE_LEVELS
 * (same reasoning, independently defined — see the header note above).
 */
const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

module.exports = {
  EDUCATIONAL_INTENTS,
  EDUCATIONAL_INTENT_IDS,
  CONFIDENCE_LEVELS,
};
