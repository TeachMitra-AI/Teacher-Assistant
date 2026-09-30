// Assistant telemetry, in two channels:
//   1. One structured stdout line per interpret decision (high volume, no database cost).
//   2. `Event` rows for prefill delivered and its outcome, at most two per routed session.
// `Event` is a rare-incident table on single-writer SQLite that serves every authenticated request; one row
// per interpret call would turn it into a sustained write stream.
// Privacy: nothing here may carry an utterance, a slot value, generated content, prompt text or model output,
// only counts, ids, enum values and field names. buildMetadata reads an explicit key list, so an extra key is
// never stored. Every function is best-effort and never throws; a failed write is logged and dropped.

const { prisma } = require('../lib/db');
const { DESCRIPTORS } = require('../actions/registry');
const {
  ASSISTANT_EVENT_NAMES,
  PREFILL_OUTCOMES,
  MAX_EVENT_METADATA_LENGTH,
} = require('./contracts');

/**
 * Metadata-only structured log (channel 1), same shape as `logAiEvent` in index.js. It lives here because
 * index.js requires routes/assistant.js, which requires this module, and a CommonJS cycle would be partially initialised.
 * Never pass utterance text or slot values; ids, counts, enums and latencies only.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} event
 * @param {object} [meta]
 */
function logAssistantEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[assistant] ${event}`, meta);
}

/** Client event name -> `Event.type`. Stored types are prefixed so retention can be scoped safely in a shared column. */
const EVENT_TYPE_BY_NAME = Object.freeze({
  prefill_delivered: 'assistant_prefill_delivered',
  prefill_outcome: 'assistant_prefill_outcome',
});

/**
 * Every slot name any registered action declares. Correction events name a field, so the allow-list comes
 * from the registry (new actions work with no edit here) and a client can't smuggle a topic into `field`.
 */
const KNOWN_SLOT_NAMES = Object.freeze(
  Array.from(new Set(DESCRIPTORS.flatMap((descriptor) => (descriptor.slots || []).map((slot) => slot.name))))
);

/** Is this a field name the registry actually declares? */
function isKnownSlotName(field) {
  return KNOWN_SLOT_NAMES.includes(field);
}

/** Every registry action id, including deprecated ones, since cached PWA clients still send them. */
const KNOWN_ACTION_IDS = Object.freeze(DESCRIPTORS.map((descriptor) => descriptor.id));

/**
 * Is this an action this server has? A length bound isn't a privacy control: `actionId` allows 60 chars,
 * enough for a topic. Unknown ids are dropped, since the row would be unqueryable anyway.
 */
function isKnownActionId(actionId) {
  return KNOWN_ACTION_IDS.includes(actionId);
}

/**
 * Build the metadata JSON for a row from an explicit key list, never by spreading the caller's object,
 * so an unexpected key can't leak. Deleting known-bad keys would fail the first time a new one appears.
 *
 * @param {object} event a validated client event
 * @returns {string|null} JSON, or null if it exceeded the size bound
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
    // Field names and previous provenance, never values. Unknown names are dropped so the outcome row
    // (the denominator) isn't lost over one correction.
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
 * Persist validated client telemetry events; never throws, failed writes are logged and dropped.
 * At most two rows per routed session: corrections are counted into the outcome row by the client
 * rather than written one by one. Writes are sequential since the store is single-writer.
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
    // Unreachable via the route, but a second caller with a typo should drop the event, not write an unqueryable row.
    if (!type) {
      failed += 1;
      continue;
    }

    // Unknown action: unqueryable row, and a field wide enough to hold a topic. Drop it.
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
