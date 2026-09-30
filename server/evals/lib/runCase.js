// Case execution. It drives the real pipeline (interpret() from src/assistant/interpret.js with the real classifier,
// proposal gate, resolver and policy), and only the socket is stubbed (see cassette.js).
// It calls interpret() directly rather than over HTTP, so the eval measures the pipeline and not the HTTP shell,
// which has its own tests. The 500-character envelope limit is a route-level check and isn't exercised here.
// Memory is carried by applying `memoryUpdates` verbatim and nothing else, as the client does, since resolver.js
// re-applies expiry to whatever the client sends. This file therefore re-implements no rules.

const crypto = require('crypto');

const { GeminiService } = require('../../src/gemini');
const { interpret } = require('../../src/assistant/interpret');
const { createDisabledBreaker } = require('../../src/assistant/breaker');
const { listForRole, CATALOG_VERSION } = require('../../src/actions/registry');
const { buildSystemInstruction, describeAction } = require('../../src/assistant/classifier');
const { buildResponseSchema } = require('../../src/assistant/proposalSchema');

/**
 * The routing tunables, mirroring how index.js builds `geminiFast`. They're literals, not read from the
 * environment, so a baseline is reproducible across machines. The endpoint is the one value read from the
 * environment, since recording modelVersion exists because the endpoint can move.
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
 * The flag environment a run executes under: both actions on, everything else at its default. Passed as an
 * object to `listForRole` and never written to process.env.
 */
const RUN_ENV = Object.freeze({
  ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
  ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
});

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * The four provenance hashes recorded in every baseline, separate because they answer different questions:
 *   promptHash     - the exact system instruction; changes with the preamble or any descriptor.
 *   descriptorHash - what the classifier is told the app can do (projection plus response schema).
 *   registryHash   - the authorization surface (ids, versions, effects, roles, flags, autoExecute, catalog
 *                    version); a change is security-relevant even if the prompt is byte-identical.
 *   modelVersion   - captured from the response, since the endpoint is a floating alias and the model can move.
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
 * Build everything a run needs: the descriptor set, the hashes, and a GeminiService wired to the supplied fetch seam.
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
 * Run one turn. `seam.state` is reset per turn so `classifierCalls` is the number of upstream calls this
 * utterance caused, the direct evidence for the emergency hard gate.
 */
async function runTurn({ context, seam, caseId, turn, utterance, profile, memory, pace }) {
  // Pacing happens here, before the request starts, never inside the fetch seam: a sleep there eats into gemini.js's
  // 5 s total deadline and turns rate-limit avoidance into timeouts.
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
      // Stated explicitly rather than relying on interpret()'s default: a run that hits the upstream per-minute cap must
      // keep measuring routing quality, not infrastructure state. With a live breaker, one 429 storm would open it and the
      // rest of the corpus would score as passthroughs. Neither the budget nor the breaker belongs in a measurement harness.
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
 * Run a multi-turn session, threading memory forward. Turn numbers are positional and 1-based, as the resolver's TTL arithmetic expects.
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

    // The only memory rule here: carry forward what the server offered. Expiry is re-applied server-side on the next call.
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
