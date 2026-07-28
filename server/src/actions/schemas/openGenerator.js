// Parameter schema for the `open_generator` capability.
//
// The action takes no parameters — it just navigates to the generator with
// nothing pre-filled. An empty `.strict()` object rather than `null` so that
// EVERY descriptor has a schema of the same kind: the registry's startup
// validation and the resolver can then treat all actions uniformly instead of
// branching on "does this one have parameters?". Uniformity is worth one line.
//
// `.strict()` matters even with no fields: it means a proposal that somehow
// arrives carrying parameters for a parameterless action is rejected rather
// than silently ignored.

const { z } = require('zod');

const openGeneratorSchema = z.object({}).strict();

module.exports = { openGeneratorSchema };
