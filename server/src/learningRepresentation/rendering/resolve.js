// Renderable representation resolution — AI Learning Representation System,
// Phase C (docs/learning-representation-system-adr.md, §13 Phase C).
//
// The composition described in the Phase B review: a representation is only
// offered when BOTH (1) the classifier's confidence was sufficient AND (2) a
// working renderer exists for it. Those are two independent signals and
// neither substitutes for the other — (1) is about whether the
// CLASSIFICATION can be trusted (mapping.js, Phase B, already approved and
// left untouched here), (2) is about whether the IMPLEMENTATION exists yet
// (schemas.js, Phase C, added in this phase). This module is the seam where
// they combine; it is new Phase C code specifically because it depends on
// schemas.js, which did not exist when Phase B was approved.
//
// A representation with no renderer degrades exactly the way a low-confidence
// classification already does — abstain to verbal_explanation, same
// {representation, source: 'abstained', reason} shape mapping.js already
// established. This is a deliberate reuse of an existing mechanism rather
// than a second, differently-shaped "unavailable" outcome for a caller to
// learn separately.

const { resolveRepresentation } = require('../mapping');
const { VERBAL_EXPLANATION } = require('../representations');
const { hasRenderer } = require('./schemas');

/**
 * Apply the renderer-availability gate to an already-resolved representation.
 *
 * Kept separate from resolveRenderableRepresentation() below so the gate
 * itself is testable with a synthetic `resolved` value, without needing a
 * real classifier result or a temporarily-broken registry to exercise the
 * "no renderer available" branch.
 *
 * @param {{representation: string, source: 'mapped'|'abstained', reason?: string}} resolved
 * @returns {{representation: string, source: 'mapped'|'abstained', reason?: string}}
 */
function gateOnRenderer(resolved) {
  // verbal_explanation never needs a renderer — the text answer already IS
  // the representation — so it is never subject to this gate, in either
  // direction. Whatever mapping.js decided (mapped or abstained) passes
  // through unchanged.
  if (resolved.representation === VERBAL_EXPLANATION) return resolved;

  if (hasRenderer(resolved.representation)) return resolved;

  return { representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'renderer_unavailable' };
}

/**
 * Resolve a Phase A classifier result all the way to a representation that
 * is both a confident classification AND something this system can actually
 * render today.
 *
 * @param {{ok: true, intent: string, confidence: string}|{ok: false, reason: string}} classified
 * @returns {{representation: string, source: 'mapped'|'abstained', reason?: string}}
 */
function resolveRenderableRepresentation(classified) {
  return gateOnRenderer(resolveRepresentation(classified));
}

module.exports = {
  gateOnRenderer,
  resolveRenderableRepresentation,
};
