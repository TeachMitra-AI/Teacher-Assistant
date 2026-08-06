// Structured render specs — AI Learning Representation System, Phase C
// (docs/learning-representation-system-adr.md, §6, §13 Phase C).
//
// One entry per Learning Representation that can actually be rendered. This
// module IS the renderer-availability registry the Phase B review asked
// about: a representation id is "supported" precisely when it has an entry
// here (RENDERABLE_REPRESENTATION_IDS / hasRenderer() below are trivial
// derivations of RENDER_SPECS' keys, not a separately maintained list that
// could drift from it).
//
// `verbal_explanation` deliberately has NO entry. It is the one
// representation that is never rendered — the text answer already IS the
// representation — so "does verbal_explanation have a renderer" is not a
// question this registry needs to answer; rendering/resolve.js short-circuits
// before ever asking it.
//
// Every schema here is STRUCTURED DATA (nodes, rows, points), never a pixel
// image — the ADR §6 decision this whole feature is built around. Two
// bounds exist on every text field and every array, for the same reason
// assistant/proposalSchema.js bounds free-text slots (see its own
// comment): an unbounded field gives the decoder nowhere to stop, and a
// model that degenerates mid-generation produces truncated, unparseable
// JSON instead of a diagram. The REQUESTED bound (sent to Gemini via
// responseSchema) gives the decoder a stopping point; the ACCEPT bound
// (enforced by the zod schema below it) is what the application actually
// trusts, and is deliberately a little looser so tightening the requested
// bound later can never start rejecting output it previously accepted.
//
// Array bounds are enforced ONLY in the zod layer, not in the Gemini
// responseSchema — matching assistant/proposalSchema.js's MAX_ALTERNATIVES,
// which is a zod `.max()` with no corresponding `maxItems` in the
// responseSchema sent to the model. Gemini's structured-output support for
// array length constraints is inconsistent enough that this project's
// existing convention is to not depend on it.
//
// Every entry also carries a `version` (ADR Phase E). Bump it whenever a
// change to that entry's `instructions`, `responseSchema` or `resultSchema`
// could plausibly change rendered output for input that was previously
// cached — the same granularity assistant/contracts.js's
// `ActionDescriptor.version` already documents ("bumped on breaking slot
// changes"). `version` is part of rendering/cache.js's cache key, so a bump
// IS the invalidation mechanism: every previously-cached entry for that
// representation becomes permanently unreachable under the new version,
// with no explicit purge step required. A change to renderer.js's shared
// PREAMBLE (common to all six types) means bumping every entry's version
// together, by discipline rather than a second version dimension.

const { z } = require('zod');
const { LEARNING_REPRESENTATION_IDS, VERBAL_EXPLANATION } = require('../representations');

const REQUESTED_LABEL_LENGTH = 80;
const MAX_LABEL_LENGTH = 120;
const REQUESTED_DESCRIPTION_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 320;

const label = () => z.string().trim().min(1).max(MAX_LABEL_LENGTH);
const description = () => z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH);
const labelField = { type: 'STRING', maxLength: REQUESTED_LABEL_LENGTH };
const descriptionField = { type: 'STRING', maxLength: REQUESTED_DESCRIPTION_LENGTH };

const RENDER_SPECS = Object.freeze({
  process_diagram: Object.freeze({
    version: 1,
    instructions:
      'Break the answer down into an ORDERED sequence of steps. Each step needs a short label and a one-sentence description. The array order IS the flow — step 1 happens before step 2, and so on. Use between 2 and 12 steps; do not pad with trivial steps to reach a target count.',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        steps: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { label: labelField, description: descriptionField },
            required: ['label', 'description'],
          },
        },
      },
      required: ['steps'],
    },
    resultSchema: z
      .object({
        steps: z
          .array(z.object({ label: label(), description: description() }).strict())
          .min(2)
          .max(12),
      })
      .strict(),
  }),

  comparison_table: Object.freeze({
    version: 1,
    instructions:
      'Identify the items being compared (2 to 6 of them) and the dimensions they are compared along (1 to 6 dimensions). For EVERY dimension, report exactly one value per item, IN THE SAME ORDER as the items list — the value arrays must align positionally with the items array.',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        items: { type: 'ARRAY', items: labelField },
        rows: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              dimension: labelField,
              values: { type: 'ARRAY', items: descriptionField },
            },
            required: ['dimension', 'values'],
          },
        },
      },
      required: ['items', 'rows'],
    },
    resultSchema: z
      .object({
        items: z.array(label()).min(2).max(6),
        rows: z
          .array(z.object({ dimension: label(), values: z.array(description()).min(1).max(6) }).strict())
          .min(1)
          .max(6),
      })
      .strict()
      .refine((data) => data.rows.every((row) => row.values.length === data.items.length), {
        message: 'each row’s values must align 1:1 with items',
      }),
  }),

  timeline: Object.freeze({
    version: 1,
    instructions:
      'List the events IN CHRONOLOGICAL ORDER (the array order is the timeline order). Each event needs a "when" (a date, year, or period, exactly as specific as the answer supports — do not invent a precise date the answer does not give), a short label, and a one-sentence description. Use between 2 and 12 events.',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        events: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { when: labelField, label: labelField, description: descriptionField },
            required: ['when', 'label', 'description'],
          },
        },
      },
      required: ['events'],
    },
    resultSchema: z
      .object({
        events: z
          .array(z.object({ when: label(), label: label(), description: description() }).strict())
          .min(2)
          .max(12),
      })
      .strict(),
  }),

  hierarchy_diagram: Object.freeze({
    version: 1,
    instructions:
      'Describe the classification or parent/child structure as a FLAT list of nodes. Each node has a short "id" (unique, used only for linking, never shown to the reader), a "label" (what is actually shown), and a "parentId" — the id of its parent node, or null for the single top-level root. There must be EXACTLY ONE node with parentId null, every other parentId must reference another node’s id, and ids must be unique. Use between 2 and 24 nodes.',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        nodes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: labelField,
              label: labelField,
              parentId: { type: 'STRING', maxLength: REQUESTED_LABEL_LENGTH, nullable: true },
            },
            required: ['id', 'label', 'parentId'],
          },
        },
      },
      required: ['nodes'],
    },
    resultSchema: z
      .object({
        nodes: z
          .array(
            z
              .object({ id: label(), label: label(), parentId: z.union([label(), z.null()]) })
              .strict()
          )
          .min(2)
          .max(24),
      })
      .strict()
      .refine(
        (data) => {
          const ids = data.nodes.map((node) => node.id);
          if (new Set(ids).size !== ids.length) return false;
          const roots = data.nodes.filter((node) => node.parentId === null);
          if (roots.length !== 1) return false;
          return data.nodes.every((node) => node.parentId === null || ids.includes(node.parentId));
        },
        { message: 'nodes must form a single tree: unique ids, exactly one root, every parentId must resolve' }
      ),
  }),

  labeled_diagram: Object.freeze({
    version: 1,
    instructions:
      'List the named parts that make up the object (2 to 12 of them). Each part needs a short label and a one-sentence description of what it does or where it sits. This is a composition, not a sequence — order does not imply flow or time here.',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        parts: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { label: labelField, description: descriptionField },
            required: ['label', 'description'],
          },
        },
      },
      required: ['parts'],
    },
    resultSchema: z
      .object({
        parts: z
          .array(z.object({ label: label(), description: description() }).strict())
          .min(2)
          .max(12),
      })
      .strict(),
  }),

  graph_chart: Object.freeze({
    version: 1,
    instructions:
      'Extract the quantitative data as one or more series of (x, y) points, where x is a label (a year, category or sampled input) and y is a NUMBER. Choose chartType "line" for a trend or a continuous function and "bar" for a comparison across discrete categories. Provide axis labels. Use 1 to 4 series and 2 to 24 points per series. Every y value must come from the answer or be a direct, defensible reading of it — never invent a data point the answer does not support.',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        chartType: { type: 'STRING', enum: ['line', 'bar'] },
        xLabel: labelField,
        yLabel: labelField,
        series: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              name: labelField,
              points: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: { x: labelField, y: { type: 'NUMBER' } },
                  required: ['x', 'y'],
                },
              },
            },
            required: ['name', 'points'],
          },
        },
      },
      required: ['chartType', 'xLabel', 'yLabel', 'series'],
    },
    resultSchema: z
      .object({
        chartType: z.enum(['line', 'bar']),
        xLabel: label(),
        yLabel: label(),
        series: z
          .array(
            z
              .object({
                name: label(),
                points: z.array(z.object({ x: label(), y: z.number() }).strict()).min(2).max(24),
              })
              .strict()
          )
          .min(1)
          .max(4),
      })
      .strict(),
  }),
});

const RENDERABLE_REPRESENTATION_IDS = Object.freeze(Object.keys(RENDER_SPECS));

/**
 * Whether a representation id has a working structured renderer. This is the
 * check Phase D (and any earlier caller) must run ALONGSIDE the confidence
 * check already enforced by mapping.js#resolveRepresentation — see
 * rendering/resolve.js, which composes the two.
 *
 * @param {string} representationId
 * @returns {boolean}
 */
function hasRenderer(representationId) {
  return RENDERABLE_REPRESENTATION_IDS.includes(representationId);
}

/**
 * The current version of a representation's render contract — see the
 * module header. Callers (rendering/cache.js) use this to build a cache key
 * that a version bump automatically invalidates.
 *
 * @param {string} representationId a RENDERABLE_REPRESENTATION_IDS member
 * @returns {number}
 */
function getRenderVersion(representationId) {
  return RENDER_SPECS[representationId].version;
}

// ---- Consistency guard, enforced at load time --------------------------
// Every RENDER_SPECS key must be a real, non-verbal representation id.
// Deliberately NOT a completeness guard (unlike mapping.js's): Phase C is
// explicitly allowed to cover only some representations over time (that is
// the entire premise of hasRenderer() existing), so a missing key is
// expected, not an error. A STRAY key — one that doesn't match the
// taxonomy at all, e.g. a typo — is the failure mode worth catching early.
// Every entry must also carry a valid `version` (ADR Phase E) — a missing
// or malformed one would silently break cache invalidation rather than
// fail loudly, which is exactly the kind of mistake this guard exists to
// catch at boot instead of in production.
{
  const stray = RENDERABLE_REPRESENTATION_IDS.filter(
    (id) => !LEARNING_REPRESENTATION_IDS.includes(id) || id === VERBAL_EXPLANATION
  );
  if (stray.length > 0) {
    throw new Error(
      `learningRepresentation/rendering/schemas.js: RENDER_SPECS has an invalid key: [${stray.join(', ')}].`
    );
  }
  const badVersion = RENDERABLE_REPRESENTATION_IDS.filter((id) => !Number.isInteger(RENDER_SPECS[id].version) || RENDER_SPECS[id].version < 1);
  if (badVersion.length > 0) {
    throw new Error(
      `learningRepresentation/rendering/schemas.js: RENDER_SPECS has an invalid version: [${badVersion.join(', ')}].`
    );
  }
}

module.exports = {
  RENDER_SPECS,
  RENDERABLE_REPRESENTATION_IDS,
  hasRenderer,
  getRenderVersion,
};
