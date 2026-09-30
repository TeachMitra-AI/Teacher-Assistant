// A representation is offered only when the classifier's confidence was sufficient (mapping.js) and a working
// renderer exists for it (schemas.js); this is where they combine. A representation with no renderer abstains
// to verbal_explanation, the same `{representation, source: 'abstained', reason}` shape mapping.js already uses.

const { resolveRepresentation } = require('../mapping');
const { VERBAL_EXPLANATION } = require('../representations');
const { hasRenderer } = require('./schemas');

/**
 * Apply the renderer-availability gate to an already-resolved representation. Separate from
 * resolveRenderableRepresentation() so the "no renderer" branch is testable with a synthetic value.
 *
 * @param {{representation: string, source: 'mapped'|'abstained', reason?: string}} resolved
 * @returns {{representation: string, source: 'mapped'|'abstained', reason?: string}}
 */
function gateOnRenderer(resolved) {
  // verbal_explanation is never rendered (the text answer is the representation), so it passes through unchanged.
  if (resolved.representation === VERBAL_EXPLANATION) return resolved;

  if (hasRenderer(resolved.representation)) return resolved;

  return { representation: VERBAL_EXPLANATION, source: 'abstained', reason: 'renderer_unavailable' };
}

/**
 * Resolve a classifier result to a representation that is both confidently classified and renderable today.
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
