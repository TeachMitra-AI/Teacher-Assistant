// Capability descriptor: open_generator.
//
// Plain navigation — "open the generator", with nothing pre-filled. It exists
// for two reasons beyond its own modest usefulness:
//
//   1. It gives the registry a second, structurally different action (no slots,
//      a different effect class), so filtering, projection and validation are
//      exercised against variety rather than a single shape.
//   2. It is the natural landing place for an utterance that clearly means
//      "take me to the generator" but names no topic — better than a
//      half-filled form or a coaching answer about worksheets.

const { openGeneratorSchema } = require('../schemas/openGenerator');

/** @type {import('../../assistant/contracts').ActionDescriptor} */
const openGenerator = {
  id: 'open_generator',
  version: 1,
  status: 'active',
  domain: 'generator',

  // 'read' — navigation only. Reversible, visible, and destroys nothing, which
  // is why the policy is allowed to act on it directly rather than pre-filling
  // and waiting. (Phase 1 still stops at 'prefill' for everything; the
  // distinction starts mattering when the policy graduates.)
  effect: 'read',

  // Empty means "any authenticated user" — the generator page itself is
  // reachable by every signed-in role, so the descriptor mirrors that.
  requiredRoles: [],

  featureFlag: 'ASSISTANT_ACTION_OPEN_GENERATOR',
  autoExecute: false,

  summary: 'Open the quiz and worksheet generator.',

  examples: [
    'Open the generator',
    'I want to make a worksheet',
    'Take me to the quiz maker',
    'Worksheet generator kholo',
    'Where do I create a test?',
  ],

  // No slots: there is nothing to fill in.
  slots: [],

  paramSchema: openGeneratorSchema,
};

module.exports = { openGenerator };
