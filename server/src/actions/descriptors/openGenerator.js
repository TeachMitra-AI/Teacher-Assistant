// Capability descriptor: open_generator. Plain navigation with nothing pre-filled. It gives the registry a
// structurally different action (no slots, another effect class) and a landing place for "take me to the generator".

const { openGeneratorSchema } = require('../schemas/openGenerator');

/** @type {import('../../assistant/contracts').ActionDescriptor} */
const openGenerator = {
  id: 'open_generator',
  version: 1,
  status: 'active',
  domain: 'generator',

  // 'read': navigation only; reversible and destroys nothing, so the policy may act on it directly.
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
