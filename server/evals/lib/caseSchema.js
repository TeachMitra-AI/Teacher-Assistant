// The labelled-case schema. The corpus is data, and unvalidated data makes an evaluation measure nothing, so every
// case is parsed at load time and an invalid one stops the run instead of being skipped. Uses zod, already a server dependency.

const { z } = require('zod');

const { DECISIONS, PASSTHROUGH_REASONS } = require('../../src/assistant/contracts');

/** Which part of the corpus a case belongs to. Drives the per-stratum report. */
const STRATA = Object.freeze([
  'commands',
  'coaching',
  'ambiguous',
  'emergency',
  'adversarial',
  'memory',
]);

/**
 * The three languages teachers type in. `hinglish` is romanized Hindi/English code-mixing and `hi` is Devanagari.
 * They're separate because the go/no-go threshold is stated for Hinglish, and they exercise different code: `hi`
 * the NFKC/combining-mark handling, `hinglish` the phonetic-spelling tables.
 */
const LANGUAGES = Object.freeze(['en', 'hinglish', 'hi']);

/**
 * What the labeller expects for one utterance. The `stated` / `notStated` split is what makes slot hallucination
 * measurable: without an explicit "the teacher did not say this" list, a correct extraction can't be told from a
 * plausible guess (e.g. the model inferring `format: worksheet` from "I need something on photosynthesis").
 */
const expectedSchema = z
  .object({
    // The single outcome the labeller considers correct.
    decision: z.enum(['prefill', 'ask', 'passthrough']),

    // Ambiguous cases only: the outcomes a competent human would accept. Its presence moves a case into the
    // quarantined bucket, so never set it on a case with one right answer.
    acceptable: z.array(z.enum(['prefill', 'ask', 'passthrough'])).min(2).optional(),

    actionId: z.string().min(1).nullable(),

    // Which slot the clarifying question must be about, when decision is 'ask'.
    askSlot: z.string().min(1).optional(),

    // Asserted only where the label determines it: an emergency case must report `emergency_detected`, but a coaching
    // question may arrive as `not_an_action` or `low_confidence`, and demanding one would measure the model's mood.
    passthroughReason: z.enum(PASSTHROUGH_REASONS).optional(),

    slots: z
      .object({
        // Stated in THIS utterance -> must arrive with provenance `utterance`.
        stated: z.record(z.string(), z.union([z.string(), z.number()])).default({}),

        // Should be carried from a previous turn -> provenance `memory`.
        // Sessions only.
        inherited: z.record(z.string(), z.union([z.string(), z.number()])).default({}),

        // NOT stated. Filling any of these with provenance `utterance` is a
        // hallucination and is counted as one.
        notStated: z.array(z.string()).default([]),

        // Memory holds a value for these, but it has expired or been overridden
        // and must NOT be used. Provenance `memory` here is staleness.
        mustNotInherit: z.array(z.string()).default([]),
      })
      .strict()
      .default({ stated: {}, inherited: {}, notStated: [], mustNotInherit: [] }),
  })
  .strict();

/** The teacher's saved preferences, fixed per case so defaults are deterministic. */
const profileSchema = z
  .object({
    defaultGrade: z.string().optional(),
    defaultSubject: z.string().optional(),
    defaultLanguage: z.string().optional(),
  })
  .strict()
  .default({});

/** One single-turn labelled utterance. */
const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/, 'id must be dot-separated lowercase'),
    stratum: z.enum(STRATA),
    language: z.enum(LANGUAGES),
    utterance: z.string().min(1),
    // Why this case exists. Optional, but the reviewer in the manual procedure
    // reads these, so a case whose label is non-obvious should carry one.
    notes: z.string().optional(),
    profile: profileSchema,
    expected: expectedSchema,
  })
  .strict();

/** One multi-turn session. Turn numbers are positional, starting at 1. */
const sessionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
    stratum: z.literal('memory'),
    language: z.enum(LANGUAGES),
    notes: z.string().optional(),
    profile: profileSchema,
    turns: z
      .array(
        z
          .object({
            utterance: z.string().min(1),
            notes: z.string().optional(),
            expected: expectedSchema,
          })
          .strict()
      )
      .min(2),
  })
  .strict();

module.exports = { STRATA, LANGUAGES, DECISIONS, caseSchema, sessionSchema, expectedSchema };
