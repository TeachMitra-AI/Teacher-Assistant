// Learning Representation taxonomy — AI Learning Representation System,
// Phase B (docs/learning-representation-system-adr.md, §4).
//
// Frozen wire vocabulary for what a response may be presented as, alongside
// its text. Seven representations, all STRUCTURED (ADR §6) — none of them is
// a diffusion-generated image. That is a load-bearing V1 constraint, not an
// oversight: ADR §6 explains why pixel generation is deferred (unreliable
// labels, higher cost/latency, inconsistent style) and ADR §8 lists it as
// explicitly out of scope.
//
// `verbal_explanation` is the default and the ONLY representation
// `no_visualization` ever maps to (see mapping.js) — it is not a fallback
// bolted on afterwards, it is a first-class entry in this taxonomy, matching
// how `no_visualization` is a first-class entry in the intent taxonomy
// (contracts.js).

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

/**
 * The representation every abstain path resolves to — a classifier failure,
 * a low-confidence result, or the `no_visualization` intent itself. Exported
 * as a named constant (rather than the literal string re-typed at each call
 * site) so mapping.js's abstain branches and any future caller agree on
 * exactly one value.
 */
const VERBAL_EXPLANATION = 'verbal_explanation';

module.exports = {
  LEARNING_REPRESENTATIONS,
  LEARNING_REPRESENTATION_IDS,
  VERBAL_EXPLANATION,
};
