// Parameter schema for `open_generator`, which takes none. An empty `.strict()` object (not null) keeps
// every descriptor's schema the same kind, and rejects a proposal that arrives with parameters.

const { z } = require('zod');

const openGeneratorSchema = z.object({}).strict();

module.exports = { openGeneratorSchema };
