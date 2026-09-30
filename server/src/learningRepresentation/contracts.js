// Educational Intent taxonomy: the single definition of the intents, so the classifier prompt and the parser can't drift.
// Seven non-overlapping intents (see docs/learning-representation-system-adr.md). `no_visualization` is a
// first-class, frequently correct outcome, not a catch-all.
// Self-contained rather than importing CONFIDENCE_LEVELS from assistant/contracts.js, since the two features are independent.
// Every intent's examples include Hindi or Hinglish phrasing, because the examples are what teach Gemini how code-mixed input looks.

const EDUCATIONAL_INTENTS = Object.freeze([
  Object.freeze({
    id: 'explain_process',
    description: 'The content is a sequence of steps or a cause-effect chain.',
    examples: [
      'Explain the TCP handshake.',
      'How does digestion work?',
      'Photosynthesis kaise hota hai, samjhao.',
      'Paani ka cycle explain karo.',
    ],
  }),
  Object.freeze({
    id: 'compare_concepts',
    description: 'The content contrasts two or more things along shared dimensions.',
    examples: [
      'Compare mitosis and meiosis.',
      'Capitalism vs. socialism.',
      'Mitosis aur meiosis mein kya fark hai?',
      'Compound aur mixture ka difference batao.',
    ],
  }),
  Object.freeze({
    id: 'show_chronology',
    description: 'The content is a sequence of events situated in time.',
    examples: [
      'Timeline of the Mughal Empire.',
      'Key events of World War II.',
      'Mughal Empire ka timeline batao.',
      'Bharat ki azaadi ki important tareekhein kya thi?',
    ],
  }),
  Object.freeze({
    id: 'show_hierarchy',
    description: 'The content is a classification, taxonomy, or parent/child structure.',
    examples: [
      'Classify the animal kingdom.',
      'What is the org structure of a Roman legion?',
      'Animal kingdom ko classify karke dikhao.',
      'Bharat sarkar ke teen ang (branches) kya hain?',
    ],
  }),
  Object.freeze({
    id: 'explain_structure',
    description:
      'The content is a composition of parts, a spatial arrangement, or how those parts relate — whether the goal is naming parts or understanding how they work together.',
    examples: [
      'Label the human heart.',
      'Parts of a plant cell.',
      'Dil (heart) ke parts label karke batao.',
      'Plant cell ke parts kya-kya hote hain?',
    ],
  }),
  Object.freeze({
    id: 'show_quantitative_data',
    description: 'The content is numeric and its meaning depends on magnitude, trend, or distribution.',
    examples: [
      "Show India's population growth over the last 50 years.",
      'Graph y = x squared.',
      'Pichle 50 saal mein India ki population kaise badhi, dikhao.',
      'y = x square ka graph banao.',
    ],
  }),
  Object.freeze({
    id: 'no_visualization',
    description:
      'The content is definitional, opinion-based, a single fact, or otherwise has no structure a non-prose representation would clarify.',
    examples: [
      'What year was Mahatma Gandhi born?',
      'Is this a good essay topic for Class 8?',
      'Mahatma Gandhi kis saal paida hue the?',
      'Class 8 ke liye yeh essay topic accha hai kya?',
    ],
  }),
]);

const EDUCATIONAL_INTENT_IDS = Object.freeze(EDUCATIONAL_INTENTS.map((intent) => intent.id));

/** Model-reported confidence; ordinal rather than a float, as in assistant/contracts.js. */
const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

module.exports = {
  EDUCATIONAL_INTENTS,
  EDUCATIONAL_INTENT_IDS,
  CONFIDENCE_LEVELS,
};
