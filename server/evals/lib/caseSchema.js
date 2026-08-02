// The labelled-case schema (Milestone M7a).
//
// The corpus is DATA, and unvalidated data is how an evaluation harness ends up
// measuring nothing at all. Every case is parsed through these schemas at load
// time; a case that does not validate stops the run rather than being skipped,
// for the same reason the M2 drift test asserts a non-zero member count before
// comparing: a check that silently matches nothing is worse than no check.
//
// Uses zod, which is already a server dependency — M7 adds no new package.

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
 * The three languages a target teacher actually types in.
 *
 * `hinglish` means romanized Hindi/English code-mixing, `hi` means Devanagari.
 * They are separated rather than merged because the go/no-go threshold in the
 * architecture document is stated for Hinglish specifically, and because the
 * two exercise completely different code: `hi` exercises the NFKC/combining-mark
 * handling that M6 found a real tokenizer bug in, `hinglish` exercises the
 * phonetic-spelling tables.
 */
const LANGUAGES = Object.freeze(['en', 'hinglish', 'hi']);

/**
 * What the labeller expects to come back for one utterance.
 *
 * THE `stated` / `notStated` SPLIT IS THE LOAD-BEARING PART. Without an explicit
 * "the teacher did not say this" list, slot hallucination is unmeasurable: there
 * is no way to tell a correct extraction from a plausible guess that happened to
 * look right. That distinction is exactly the gap recorded live at M5 (the model
 * inferring `format: worksheet` from "I need something on photosynthesis") and
 * again at M6, so the corpus format is built to make it countable.
 */
const expectedSchema = z
  .object({
    // The single outcome the labeller considers correct.
    decision: z.enum(['prefill', 'ask', 'passthrough']),

    // AMBIGUOUS CASES ONLY: the full set of outcomes a competent human would
    // accept. Its presence is what moves a case into the quarantined bucket, so
    // it is never set on a case that has one right answer.
    acceptable: z.array(z.enum(['prefill', 'ask', 'passthrough'])).min(2).optional(),

    actionId: z.string().min(1).nullable(),

    // Which slot the clarifying question must be about, when decision is 'ask'.
    askSlot: z.string().min(1).optional(),

    // Asserted only where it is genuinely determined by the label — an emergency
    // case must report `emergency_detected`, but a coaching question may
    // legitimately arrive as `not_an_action` or `low_confidence` and demanding
    // one would be measuring the model's mood.
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
