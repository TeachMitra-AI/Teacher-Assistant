// AI Action Router — telemetry (Phase 1, Milestone M8).
//
// This module owns BOTH halves of the CHANGE-6 split, deliberately in one file
// so the split is legible rather than incidental, and so the privacy rule has a
// single place to live:
//
//   Channel 1  STRUCTURED STDOUT — one line per interpret decision. High volume,
//              zero database cost. Already how every decision has been recorded
//              since M5; M8 only moves the helper here from routes/assistant.js.
//
//   Channel 2  `Event` ROWS — prefill delivered, and its outcome. At most TWO
//              rows per routed session, and nothing else.
//
// ─── WHY THE SPLIT EXISTS AT ALL ───────────────────────────────────────────
// `Event` is a RARE-INCIDENT table (safety flags, notable upstream failures,
// user approvals) on SINGLE-WRITER SQLite that also serves every authenticated
// request. One row per interpret call would convert it into a sustained write
// stream, and the symptom would arrive weeks later as generalized slowness that
// nobody attributes to the assistant. That was finding D of the final design
// review, and CHANGE-6 is its answer. The two-rows-per-session ceiling is the
// whole point of this module — see the note above writeAssistantEvents.
//
// ─── THE PRIVACY RULE (G11) ────────────────────────────────────────────────
// Nothing here may ever carry the teacher's utterance, a resolved slot VALUE,
// generated content, prompt text or model output. Only counts, ids, enum values
// and field NAMES.
//
// The rule is enforced structurally rather than by convention: buildMetadata
// below constructs its result from an explicit key list, so a caller passing an
// extra key does not leak it — the key is simply not read. Combined with the
// closed enums in contracts.js and the route's `.strict()` envelope, there is no
// path from teacher-authored text into a row, and the tests assert that by
// posting an utterance into every field and checking what lands.
//
// ─── FAILURE POSTURE ───────────────────────────────────────────────────────
// Every function here is best-effort and NEVER throws. Telemetry exists to
// measure the teacher's experience, and a measurement that can degrade the thing
// it measures is worth less than no measurement. A failed write is logged to
// channel 1 and forgotten.

const { prisma } = require('../lib/db');
const { DESCRIPTORS } = require('../actions/registry');
const {
  ASSISTANT_EVENT_NAMES,
  PREFILL_OUTCOMES,
  MAX_EVENT_METADATA_LENGTH,
} = require('./contracts');

/**
 * Metadata-only structured log — channel 1.
 *
 * Mirrors the `logAiEvent` helper in index.js in shape and discipline. It lives
 * HERE rather than in index.js because index.js requires routes/assistant.js,
 * which requires this module: importing back from the entrypoint would create a
 * cycle, and in CommonJS a cycle yields a partially-initialised module
 * (guardrail 12a). A leaf module both sides import has neither problem.
 *
 * NEVER pass utterance text or resolved slot values through here (G11). The
 * decision log carries ids, counts, enum values and latencies only.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} event
 * @param {object} [meta]
 */
function logAssistantEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[assistant] ${event}`, meta);
}

/**
 * Client event name -> `Event.type`.
 *
 * The stored type is PREFIXED (`assistant_`) while the wire name is not, for two
 * separate reasons that happen to point the same way: on the wire the name sits
 * inside an assistant-specific envelope and the prefix would be noise, while in
 * the table it shares a column with `ai_safety_flag` and `user_approved` and the
 * prefix is what lets retention scope itself safely.
 */
const EVENT_TYPE_BY_NAME = Object.freeze({
  prefill_delivered: 'assistant_prefill_delivered',
  prefill_outcome: 'assistant_prefill_outcome',
});

/**
 * Every slot name any registered action declares.
 *
 * Correction events name a FIELD, and a field name is only meaningful if the
 * registry actually declares it. Deriving the allow-list from the registry
 * rather than hardcoding it means a Phase 2 action's slots are accepted the day
 * the descriptor lands, with no edit here — which is the same "adding an action
 * touches no core file" property §8.3 of the spec demands.
 *
 * It also closes a small leak: without it, `field` is a client-supplied string
 * and a buggy (or hostile) client could put a topic in it. With it, anything not
 * on this list is dropped before it reaches a row.
 */
const KNOWN_SLOT_NAMES = Object.freeze(
  Array.from(new Set(DESCRIPTORS.flatMap((descriptor) => (descriptor.slots || []).map((slot) => slot.name))))
);

/** Is this a field name the registry actually declares? */
function isKnownSlotName(field) {
  return KNOWN_SLOT_NAMES.includes(field);
}

/**
 * Every action id the registry knows, including deprecated ones — actions are
 * deprecated rather than deleted precisely because cached PWA clients keep
 * referring to them, and telemetry from a stale client is still worth having.
 */
const KNOWN_ACTION_IDS = Object.freeze(DESCRIPTORS.map((descriptor) => descriptor.id));

/**
 * Is this an action this server actually has?
 *
 * A LENGTH BOUND IS NOT A PRIVACY CONTROL for this field. `actionId` is 60
 * characters, and a topic fits in 60 characters — an integration test posted
 * teacher text through it and watched it reach a row, which is exactly why this
 * check exists rather than being assumed unnecessary. An event naming an unknown
 * action is dropped: the row would be unqueryable anyway, so there is no cost to
 * refusing it and a real cost to storing it.
 */
function isKnownActionId(actionId) {
  return KNOWN_ACTION_IDS.includes(actionId);
}

/**
 * Build the metadata JSON for a row.
 *
 * CONSTRUCTED FROM AN EXPLICIT KEY LIST, never by spreading the caller's object.
 * That is the structural half of G11: an event carrying an unexpected key does
 * not leak it, because nothing reads it. The alternative — spread and then
 * delete the keys we know are dangerous — fails the moment somebody invents a
 * new dangerous key, which is exactly the failure mode a privacy control must
 * not have.
 *
 * @param {object} event a validated client event
 * @returns {string|null} JSON, or null if it somehow exceeded the size bound
 */
function buildMetadata(event) {
  const metadata = { actionId: event.actionId };

  // The join key back to channel 1. Opaque UUID minted by the interpret
  // endpoint; carries nothing teacher-derived.
  if (typeof event.requestId === 'string' && event.requestId) {
    metadata.requestId = event.requestId;
  }
  if (Number.isInteger(event.fieldCount)) metadata.fieldCount = event.fieldCount;
  if (Number.isInteger(event.lowConfidenceCount)) metadata.lowConfidenceCount = event.lowConfidenceCount;
  if (PREFILL_OUTCOMES.includes(event.outcome)) metadata.outcome = event.outcome;

  if (Array.isArray(event.corrections)) {
    // Field NAMES and their previous provenance — never what the fields held.
    // Unknown names are dropped rather than rejecting the whole event: losing
    // one correction is immaterial, losing the outcome row would break the
    // denominator.
    const corrections = event.corrections
      .filter((correction) => correction && isKnownSlotName(correction.field))
      .map((correction) => ({ field: correction.field, from: correction.from }));
    metadata.corrections = corrections;
    metadata.correctedCount = corrections.length;
  }

  const json = JSON.stringify(metadata);
  return json.length <= MAX_EVENT_METADATA_LENGTH ? json : null;
}

/**
 * Persist a batch of validated client telemetry events.
 *
 * ─── THE VOLUME GUARANTEE ──────────────────────────────────────────────────
 * At most TWO rows per routed session, and this function is only half of why.
 * The other half is that corrections are COUNTED INTO the outcome row rather
 * than written individually: a teacher who edits six fields produces six
 * `field_corrected` events client-side, which the client collapses into one
 * outcome row before it ever reaches the network. Writing a row per correction
 * would be the single easiest way to reintroduce exactly the write stream
 * CHANGE-6 was created to prevent.
 *
 * Writes are sequential rather than concurrent: the backing store is
 * single-writer, so a Promise.all here would buy nothing and would make a
 * partial failure harder to reason about.
 *
 * NEVER THROWS. A failed write is logged and dropped.
 *
 * @param {object[]} events already validated against the route's envelope
 * @param {{userId: string|null, schoolId: string|null, requestId: string}} context
 * @returns {Promise<{written: number, failed: number}>} for logging and tests
 */
async function writeAssistantEvents(events, { userId, schoolId, requestId }) {
  let written = 0;
  let failed = 0;

  for (const event of events) {
    const type = EVENT_TYPE_BY_NAME[event.name];
    // Unreachable via the route (the envelope enum already closed this), but a
    // second caller with a typo should drop the event rather than write a row
    // with an undefined type that no query will ever find again.
    if (!type) {
      failed += 1;
      continue;
    }

    // Unknown action => unqueryable row, and a field wide enough to hold a
    // topic. Dropped rather than stored (G11).
    if (!isKnownActionId(event.actionId)) {
      logAssistantEvent('warn', 'telemetry_unknown_action', { requestId, type });
      failed += 1;
      continue;
    }

    const metadata = buildMetadata(event);
    if (metadata === null) {
      logAssistantEvent('warn', 'telemetry_metadata_oversized', { requestId, type });
      failed += 1;
      continue;
    }

    try {
      await prisma.event.create({
        data: { userId: userId || null, schoolId: schoolId || null, type, metadata },
      });
      written += 1;
    } catch (error) {
      // Best-effort by contract. The message is the DB's, not the teacher's —
      // no request content can reach it.
      logAssistantEvent('error', 'telemetry_write_failed', { requestId, type, message: error.message });
      failed += 1;
    }
  }

  return { written, failed };
}

module.exports = {
  logAssistantEvent,
  writeAssistantEvents,
  isKnownSlotName,
  isKnownActionId,
  KNOWN_SLOT_NAMES,
  KNOWN_ACTION_IDS,
  EVENT_TYPE_BY_NAME,
  ASSISTANT_EVENT_NAMES,
};
