// Case execution (Milestone M7a).
//
// Drives the REAL pipeline: `interpret()` from src/assistant/interpret.js, with
// the real classifier, the real proposal gate, the real resolver and the real
// policy. Nothing is reimplemented here and nothing is stubbed except the socket
// (see cassette.js).
//
// It calls interpret() DIRECTLY rather than over HTTP. interpret.js was built
// database-free via injected dependencies precisely so this is possible, and it
// means the eval measures the pipeline rather than the HTTP shell — which has
// its own 943 tests covering auth, the rate limiter, the envelope and the
// rollout gate. The one consequence worth stating: the 500-character envelope
// limit is a route-level check and is therefore NOT exercised here.
//
// MEMORY IS CARRIED BY APPLYING `memoryUpdates` VERBATIM, and by nothing else.
// That is exactly what the client does — M6 decision D1 made sessionMemory.ts a
// dumb carrier because resolver.js re-applies expiry to whatever the client
// sends. So this file re-implements zero rules. Had D1 gone the other way, this
// would have become a fourth home for the TTL table.

const crypto = require('crypto');

const { GeminiService } = require('../../src/gemini');
const { interpret } = require('../../src/assistant/interpret');
const { createDisabledBreaker } = require('../../src/assistant/breaker');
const { listForRole, CATALOG_VERSION } = require('../../src/actions/registry');
const { buildSystemInstruction, describeAction } = require('../../src/assistant/classifier');
const { buildResponseSchema } = require('../../src/assistant/proposalSchema');

/**
 * The routing tunables, mirroring how index.js constructs `geminiFast`.
 *
 * Kept as literals rather than read from the environment so a baseline is
 * reproducible: an eval run whose timeouts depend on whatever happens to be in
 * a developer's .env would report latency that means nothing across machines.
 * The one value that IS read from the environment is the endpoint, because the
 * whole point of recording modelVersion is that the endpoint can move.
 */
const ROUTING_TUNABLES = Object.freeze({
  timeoutMs: 3500,
  totalTimeoutMs: 5000,
  maxRetries: 1,
  maxCallsPerRequest: 2,
  maxContinuations: 0,
  maxOutputTokens: 512,
});

const DEFAULT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

/**
 * The flag environment a run executes under: both actions on, everything else
 * at its default. Passed as an object to `listForRole`, never exported to
 * process.env — the M5/M6 practice of never editing or polluting the real
 * environment during verification.
 */
const RUN_ENV = Object.freeze({
  ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
  ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
});

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * The four provenance hashes recorded in every baseline.
 *
 * They answer different questions, which is why they are not one hash:
 *
 *   promptHash     — the exact system instruction the model was given. Changes
 *                    when the preamble changes OR when any descriptor changes.
 *   descriptorHash — what the classifier is told the app can do (the projection
 *                    plus the response schema). Changes when a capability's
 *                    described behaviour changes.
 *   registryHash   — the AUTHORIZATION surface: ids, versions, effects, roles,
 *                    flags, autoExecute, catalog version. Changes when what is
 *                    PERMITTED changes, which is a security-relevant event even
 *                    when the prompt is byte-identical.
 *   modelVersion   — captured from the response, because the endpoint is a
 *                    floating alias and the model can move underneath a run.
 */
function computeHashes(descriptors) {
  return {
    promptHash: sha(buildSystemInstruction(descriptors)),
    descriptorHash: sha(
      JSON.stringify({
        described: descriptors.map(describeAction),
        responseSchema: buildResponseSchema(descriptors),
      })
    ),
    registryHash: sha(
      JSON.stringify({
        catalogVersion: CATALOG_VERSION,
        actions: descriptors.map((descriptor) => ({
          id: descriptor.id,
          version: descriptor.version,
          status: descriptor.status,
          domain: descriptor.domain,
          effect: descriptor.effect,
          requiredRoles: descriptor.requiredRoles,
          featureFlag: descriptor.featureFlag,
          autoExecute: descriptor.autoExecute,
        })),
      })
    ),
  };
}

/**
 * Build everything a run needs: the descriptor set, the hashes, and a
 * GeminiService wired to the supplied fetch seam.
 */
function createRunContext({ fetchImpl, apiKey = process.env.GEMINI_API_KEY, endpoint } = {}) {
  const descriptors = listForRole('teacher', RUN_ENV);
  if (descriptors.length === 0) {
    throw new Error('No descriptors visible to role "teacher" — the run would measure nothing.');
  }

  const gemini = new GeminiService({
    apiKey,
    endpoint: endpoint || process.env.ASSISTANT_GEMINI_ENDPOINT || DEFAULT_ENDPOINT,
    fetchImpl,
    ...ROUTING_TUNABLES,
  });

  return {
    gemini,
    descriptors,
    env: RUN_ENV,
    endpoint: gemini.endpoint,
    ...computeHashes(descriptors),
  };
}

/** Flatten one interpret response into the record the scorer consumes. */
function toActual(response) {
  const action = (response.actions && response.actions[0]) || null;
  return {
    decision: response.passthrough ? 'passthrough' : action ? action.decision : 'passthrough',
    actionId: action ? action.actionId : null,
    passthroughReason: response.passthrough ? response.reason : null,
    params: action ? action.params : {},
    provenance: action ? action.provenance : {},
    missing: action ? action.missing : [],
    lowConfidenceFields: action ? action.lowConfidenceFields || [] : [],
    confidence: action ? action.confidence : null,
    askSlot: action && action.ask ? action.ask.slot : null,
    askOptions: action && action.ask ? (action.ask.options || []).map((o) => o.value) : null,
    memoryUpdates: response.memoryUpdates || null,
  };
}

/**
 * Run one turn.
 *
 * `seam.state` is reset per turn so `classifierCalls` is the number of upstream
 * calls THIS utterance caused. That is the direct evidence for the emergency
 * hard gate — the same assertion M5 made, that the classifier was never reached.
 */
async function runTurn({ context, seam, caseId, turn, utterance, profile, memory, pace }) {
  // Pacing happens HERE, before the request starts — never inside the fetch
  // seam. A sleep inside the seam sits inside gemini.js's own 5 s total deadline
  // and eats the budget the real call needs, which turns rate-limit avoidance
  // into a wall of timeouts. Found on this harness's second smoke run.
  if (pace) await pace();

  seam.state.caseId = caseId;
  seam.state.turn = turn;
  seam.state.calls = 0;

  const startedAt = Date.now();
  const { response } = await interpret(
    {
      utterance,
      role: 'teacher',
      memory,
      turn,
      requestId: `eval-${caseId}-${turn}`,
    },
    {
      gemini: context.gemini,
      env: context.env,
      readProfile: async () => profile || {},
      // M9, approval A6. Stated EXPLICITLY rather than relying on interpret()'s
      // default, because what this argument guarantees is the whole point: a run
      // that hits the upstream per-minute cap must keep measuring ROUTING
      // QUALITY, not infrastructure state. With a live breaker, one 429 storm
      // would open it and the rest of the corpus would score as passthroughs —
      // the M7a lesson (a rate limiter was once scored as model quality) in a
      // new costume. Neither the budget counter nor the breaker belongs in a
      // measurement harness.
      breaker: createDisabledBreaker(),
    }
  );

  return {
    actual: toActual(response),
    classifierCalls: seam.state.calls,
    latencyMs: Date.now() - startedAt,
  };
}

/** Run a single-turn case. */
async function runSingle({ context, seam, testCase, pace }) {
  const { actual, classifierCalls, latencyMs } = await runTurn({
    context,
    seam,
    pace,
    caseId: testCase.id,
    turn: 1,
    utterance: testCase.utterance,
    profile: testCase.profile,
    memory: {},
  });

  return [
    {
      caseId: testCase.id,
      turn: null,
      stratum: testCase.stratum,
      language: testCase.language,
      utterance: testCase.utterance,
      expected: testCase.expected,
      actual,
      classifierCalls,
      latencyMs,
    },
  ];
}

/**
 * Run a multi-turn session, threading memory forward.
 *
 * Turn numbers are positional and 1-based, which is what the resolver's TTL
 * arithmetic is written against.
 */
async function runSession({ context, seam, session, pace }) {
  const results = [];
  let memory = {};

  for (let index = 0; index < session.turns.length; index += 1) {
    const turnNumber = index + 1;
    const turnSpec = session.turns[index];

    const { actual, classifierCalls, latencyMs } = await runTurn({
      context,
      seam,
      pace,
      caseId: session.id,
      turn: turnNumber,
      utterance: turnSpec.utterance,
      profile: session.profile,
      memory,
    });

    // The ONLY memory rule this file applies: carry forward what the server
    // offered. Expiry is re-applied server-side on the next call.
    if (actual.memoryUpdates) memory = { ...memory, ...actual.memoryUpdates };

    results.push({
      caseId: session.id,
      turn: turnNumber,
      stratum: 'memory',
      language: session.language,
      utterance: turnSpec.utterance,
      expected: turnSpec.expected,
      actual,
      classifierCalls,
      latencyMs,
    });
  }

  return results;
}

module.exports = {
  ROUTING_TUNABLES,
  RUN_ENV,
  DEFAULT_ENDPOINT,
  computeHashes,
  createRunContext,
  runSingle,
  runSession,
  toActual,
};
