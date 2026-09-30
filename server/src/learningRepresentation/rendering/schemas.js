// Render specs: one entry per representation that can actually be rendered. A representation is supported
// exactly when it has an entry here; RENDERABLE_REPRESENTATION_IDS and hasRenderer() derive from the keys.
// `verbal_explanation` has no entry because it is never rendered (resolve.js short-circuits).
// Every schema is structured data (nodes, rows, points), never a pixel image.
// Text fields and arrays are bounded twice: a requested bound sent to Gemini gives the decoder a stopping
// point, and a slightly looser accept bound in zod is what we trust, so tightening the request never rejects
// output previously accepted. Array bounds live only in zod, since Gemini's maxItems support is inconsistent.
// Each entry carries a `version`, part of rendering/cache.js's key. Bump it when a change to `instructions`,
// `responseSchema` or `resultSchema` could change cached output; the bump invalidates old entries. A change to
// renderer.js's shared PREAMBLE means bumping every entry.

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
 * Whether a representation id has a working structured renderer. Callers must check this alongside the
 * confidence check in mapping.js; rendering/resolve.js composes the two.
 *
 * @param {string} representationId
 * @returns {boolean}
 */
function hasRenderer(representationId) {
  return RENDERABLE_REPRESENTATION_IDS.includes(representationId);
}

/**
 * The current version of a representation's render contract, used by rendering/cache.js to build keys.
 *
 * @param {string} representationId a RENDERABLE_REPRESENTATION_IDS member
 * @returns {number}
 */
function getRenderVersion(representationId) {
  return RENDER_SPECS[representationId].version;
}

// Consistency guard at load time: every RENDER_SPECS key must be a real non-verbal representation id and carry
// a valid `version`. Missing keys are fine (coverage is partial by design); a stray key or bad version would
// silently break the taxonomy or cache invalidation, so it throws on boot instead.
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
