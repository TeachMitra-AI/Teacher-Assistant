// Learning Representation taxonomy: what a response may be presented as alongside its text
// (docs/learning-representation-system-adr.md). All seven are structured; none is a generated image.
// `verbal_explanation` is the default and the only target of `no_visualization` (see mapping.js).

const LEARNING_REPRESENTATIONS = Object.freeze([
  Object.freeze({
    id: 'verbal_explanation',
    purpose: 'The default. Prose conveys the answer directly, with no additional structure.',
  }),
  Object.freeze({
    id: 'process_diagram',
    purpose: 'Shows ordered steps and the flow between them.',
  }),
  Object.freeze({
    id: 'comparison_table',
    purpose: 'Lays shared dimensions side by side across two or more items.',
  }),
  Object.freeze({
    id: 'timeline',
    purpose: 'Places events along a time axis.',
  }),
  Object.freeze({
    id: 'hierarchy_diagram',
    purpose: 'Shows parent/child or classification structure.',
  }),
  Object.freeze({
    id: 'labeled_diagram',
    purpose: 'Shows the composition of an object with named parts.',
  }),
  Object.freeze({
    id: 'graph_chart',
    purpose: 'Plots quantitative data.',
  }),
]);

const LEARNING_REPRESENTATION_IDS = Object.freeze(
  LEARNING_REPRESENTATIONS.map((representation) => representation.id)
);

/** The representation every abstain path resolves to: classifier failure, low confidence, or `no_visualization`. */
const VERBAL_EXPLANATION = 'verbal_explanation';

module.exports = {
  LEARNING_REPRESENTATIONS,
  LEARNING_REPRESENTATION_IDS,
  VERBAL_EXPLANATION,
};
