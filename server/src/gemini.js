// Gemini LLM service: builds requests, calls the API, retries on transient
// failures, and completes truncated responses. The API key lives only here,
// on the server, sourced from environment variables.
//
// AI-safety note: requests use Gemini's dedicated `systemInstruction` field
// for all trusted/app-authored content (prompts.js) and `contents` for only
// the teacher's raw question — a real structural boundary, not just string
// concatenation. Responses are checked for Gemini's own input/output safety
// signals (promptFeedback.blockReason, finishReason SAFETY/RECITATION) and
// passed through outputGuard before being returned.
//
// Reliability note: every fetch to Gemini for a single /api/coach request —
// the initial call, EVERY retry, and EVERY continuation (and its retries) —
// draws from ONE shared per-request budget (maxCallsPerRequest) and ONE
// shared overall deadline (totalTimeoutMs). Retries are NOT per-logical-call
// independent budgets. This structurally caps both cost (upstream calls) and
// latency (wall-clock) for a single request. See the per-request `tracker`
// created in generateResponse().

const { selectTemplate, languageDirective, styleDirective } = require('./prompts');
const { sanitizeOutput, MAX_OUTPUT_LENGTH } = require('./safety/outputGuard');
const { parseRetryAfter, computeBackoffMs, classifyGeminiError } = require('./lib/geminiPolicy');

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

// Fixed sampling params. maxOutputTokens is applied per-instance (configurable)
// in buildRequestBody, since it's the main output-cost lever.
const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
};

// Devanagari and other Indic scripts consume many more tokens per character
// than English, so a low cap truncates non-English answers. Keep this high
// and rely on finishReason + continuation to complete long responses.
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Wraps text in triple-backtick delimiters for a user-turn content block. */
function wrapDelimited(text) {
  return '```\n' + text + '\n```';
}

function makeDeadlineError() {
  const err = new Error('AI request exceeded the overall time budget');
  err.code = 'DEADLINE_EXCEEDED';
  return err;
}

function makeBudgetError() {
  const err = new Error('AI request exceeded the per-request call budget');
  err.code = 'BUDGET_EXHAUSTED';
  return err;
}

class GeminiService {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint;
    this.timeoutMs = config.timeoutMs; // per-call timeout
    this.maxRetries = config.maxRetries; // retries per logical call

    // Reliability / cost controls (all optional; defaults preserve prior
    // answer quality while capping worst-case cost + latency).
    this.maxCallsPerRequest = config.maxCallsPerRequest ?? 8;
    this.totalTimeoutMs = config.totalTimeoutMs ?? 60000; // overall deadline
    this.maxContinuations = config.maxContinuations ?? 4;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.backoffBaseMs = config.backoffBaseMs ?? 500;
    this.backoffCapMs = config.backoffCapMs ?? 8000;

    // Injectable seams for deterministic testing (default to real impls).
    this.now = config.now ?? (() => Date.now());
    this.rng = config.rng ?? Math.random;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    // Resolve global fetch at call time so a test's vi.stubGlobal('fetch')
    // is honored regardless of construction order.
    this.fetchImpl = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /**
   * Heuristic: is the response text a complete thought (not truncated)?
   */
  isResponseComplete(text) {
    if (!text || text.trim().length === 0) return false;
    const trimmed = text.trim();

    // Include Devanagari danda (।) and double danda (॥) so Hindi and other
    // Indic-script sentences are recognised as complete.
    const endsWithPunctuation = /[.!?:।॥]\s*$/.test(trimmed);
    const balanced = (open, close) =>
      (text.match(open) || []).length === (text.match(close) || []).length;
    const bracketsBalanced =
      balanced(/\(/g, /\)/g) && balanced(/\[/g, /\]/g) && balanced(/\{/g, /\}/g);
    const endsWithOpenList = /[:-]\s*$/.test(trimmed);
    const incompleteFormatting =
      text.includes('**') && (text.match(/\*\*/g) || []).length % 2 !== 0;

    return endsWithPunctuation && bracketsBalanced && !endsWithOpenList && !incompleteFormatting;
  }

  /**
   * @param {{ systemInstruction: string, userText: string }} params
   */
  buildRequestBody({ systemInstruction, userText }) {
    return {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { ...GENERATION_CONFIG, maxOutputTokens: this.maxOutputTokens },
      safetySettings: SAFETY_SETTINGS,
    };
  }

  /**
   * Create the per-request state shared by every fetch this request makes.
   * `callsMade` counts ALL fetches (initial + retries + continuations + their
   * retries) against the single shared budget; `continuations` counts logical
   * continuation attempts; `retries` counts retry attempts across everything.
   */
  createTracker() {
    return {
      callsMade: 0,
      retries: 0,
      continuations: 0,
      maxCalls: this.maxCallsPerRequest,
      deadline: this.now() + this.totalTimeoutMs,
      now: this.now,
      timedOut: false,
      rateLimited: false,
      safetyBlocked: false,
    };
  }

  snapshot(tracker, extra = {}) {
    return {
      correlationId: extra.correlationId,
      callsMade: tracker.callsMade,
      retries: tracker.retries,
      continuations: tracker.continuations,
      latencyMs: extra.latencyMs,
      outcome: extra.outcome,
      timedOut: tracker.timedOut,
      rateLimited: tracker.rateLimited,
      safetyBlocked: tracker.safetyBlocked,
    };
  }

  /** Is there budget + time left to attempt another fetch right now? */
  hasCapacity(tracker) {
    return tracker.callsMade < tracker.maxCalls && tracker.now() < tracker.deadline;
  }

  /**
   * Sleep for a backoff interval before a retry, unless doing so would blow
   * the overall deadline. Returns false (and marks timedOut) if the request
   * should give up instead of waiting.
   */
  async backoffAndWait(tracker, attempt, retryAfterMs) {
    const delay = computeBackoffMs(attempt, {
      baseMs: this.backoffBaseMs,
      capMs: this.backoffCapMs,
      retryAfterMs,
      rng: this.rng,
    });
    const remaining = tracker.deadline - tracker.now();
    if (delay >= remaining) {
      tracker.timedOut = true;
      return false;
    }
    await this.sleep(delay);
    return true;
  }

  /**
   * Make one logical Gemini call, retrying transient failures. Every fetch
   * (including retries) is counted against the shared `tracker` budget, and
   * every attempt respects the shared deadline. Retries stop at whichever
   * limit is hit first: maxRetries (per logical call), the shared call
   * budget, or the overall deadline.
   */
  async makeRequest(requestBody, tracker) {
    let attempt = 0;
    for (;;) {
      if (tracker.callsMade >= tracker.maxCalls) throw makeBudgetError();
      const remaining = tracker.deadline - tracker.now();
      if (remaining <= 0) {
        tracker.timedOut = true;
        throw makeDeadlineError();
      }
      const perCallTimeout = Math.min(this.timeoutMs, remaining);

      tracker.callsMade += 1;

      let response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(perCallTimeout),
        });
      } catch (fetchError) {
        // Network-level failure or per-call timeout (no HTTP status).
        const { retriable, reason } = classifyGeminiError(fetchError);
        if (reason === 'timeout') tracker.timedOut = true;
        if (!retriable || attempt >= this.maxRetries || !this.hasCapacity(tracker)) throw fetchError;
        const proceeded = await this.backoffAndWait(tracker, attempt, null);
        if (!proceeded) throw fetchError;
        attempt += 1;
        tracker.retries += 1;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Gemini API error: ${response.status}`);
        err.status = response.status;
        err.details = errorText;

        const { retriable, reason } = classifyGeminiError(err);
        if (reason === 'rate_limited') tracker.rateLimited = true;
        if (!retriable || attempt >= this.maxRetries || !this.hasCapacity(tracker)) throw err;

        const retryAfterMs = parseRetryAfter(
          response.headers && typeof response.headers.get === 'function'
            ? response.headers.get('retry-after')
            : null,
          tracker.now()
        );
        const proceeded = await this.backoffAndWait(tracker, attempt, retryAfterMs);
        if (!proceeded) throw err;
        attempt += 1;
        tracker.retries += 1;
        continue;
      }

      return await response.json();
    }
  }

  /**
   * Extract the answer text and Gemini's finishReason from a response.
   * finishReason === 'MAX_TOKENS' is the authoritative signal that the answer
   * was cut off because it hit the output-token limit.
   *
   * Also distinguishes the two safety-block cases Gemini can report, rather
   * than letting both collapse into the same generic "malformed response"
   * error: the INPUT can be blocked before generation starts
   * (promptFeedback.blockReason, empty candidates), or the OUTPUT can be
   * blocked after generation (finishReason SAFETY/RECITATION). Both throw a
   * distinguishable error (`.code`) so the route handler can show a graceful,
   * specific message instead of a generic failure. These are raised AFTER a
   * successful (200) response, i.e. outside the retry path, so a safety block
   * is never retried.
   */
  extractCandidate(response) {
    const candidates = response?.candidates;

    if ((!candidates || candidates.length === 0) && response?.promptFeedback?.blockReason) {
      const err = new Error('Input blocked by content safety filters');
      err.code = 'INPUT_BLOCKED';
      err.blockReason = response.promptFeedback.blockReason;
      throw err;
    }

    const candidate = candidates?.[0];

    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
      const err = new Error('Output blocked by content safety filters');
      err.code = 'OUTPUT_BLOCKED';
      err.finishReason = candidate.finishReason;
      throw err;
    }

    const text = (candidate?.content?.parts || [])
      .map((p) => p.text)
      .filter((t) => typeof t === 'string')
      .join('');
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('Invalid response format from LLM');
    }
    return { text, finishReason: candidate?.finishReason };
  }

  /**
   * Requests the rest of a response that was cut off. The previously-written
   * text — which is the model's own prior output, not the teacher's input,
   * but still untrusted content by this point — is delimited the same way
   * the teacher's original question is, rather than trusted as instructions.
   * The base systemInstruction (guardrails + anti-injection framing) is
   * carried forward so continuations stay under the same rules as the
   * original request. Uses the SHARED tracker, so a continuation's own
   * retries consume the same budget as everything else.
   */
  async fetchContinuation(previousText, language, baseSystemInstruction, tracker) {
    tracker.continuations += 1;
    const directive = languageDirective(language);
    const languageInstruction = directive ? ` ${directive}` : '';
    const continuationSystemInstruction = `${baseSystemInstruction}

CONTINUATION TASK:
You are continuing a response that was cut off mid-way. The text already written is provided next as user content, delimited by triple backticks. Continue EXACTLY from where it stopped. Do NOT repeat any earlier text, do NOT restart, and do NOT add any preamble — output only the remaining part of the answer.${languageInstruction}`;

    const response = await this.makeRequest(
      this.buildRequestBody({
        systemInstruction: continuationSystemInstruction,
        userText: wrapDelimited(previousText),
      }),
      tracker
    );
    return this.extractCandidate(response);
  }

  /**
   * Generic content generation for the Lesson Plan Workspace AI actions.
   * Unlike generateResponse (which builds a coaching prompt from templates),
   * the caller supplies a fully-formed trusted systemInstruction and the
   * delimited untrusted userText. Shares the same per-request budget/deadline,
   * retry, continuation, and output-sanitization machinery so cost and latency
   * are bounded identically. Returns only { text, metrics } — no coaching
   * fields — and never persists anything itself.
   * @param {{systemInstruction: string, userText: string, language?: string}} params
   * @param {{correlationId?: string}} [options]
   */
  async generateContent({ systemInstruction, userText, language = 'en' }, options = {}) {
    const startTime = this.now();
    const tracker = this.createTracker();

    try {
      const first = this.extractCandidate(
        await this.makeRequest(this.buildRequestBody({ systemInstruction, userText }), tracker)
      );
      let text = first.text;
      let finishReason = first.finishReason;

      for (
        let i = 0;
        finishReason === 'MAX_TOKENS' &&
        i < this.maxContinuations &&
        text.length < MAX_OUTPUT_LENGTH &&
        this.hasCapacity(tracker);
        i++
      ) {
        try {
          const cont = await this.fetchContinuation(text, language, systemInstruction, tracker);
          if (!cont.text.trim()) break;
          text = `${text.trim()} ${cont.text.trim()}`;
          finishReason = cont.finishReason;
        } catch {
          break;
        }
      }

      const sanitized = sanitizeOutput(text, { systemInstructionText: systemInstruction });
      const latencyMs = this.now() - startTime;
      const outcome = sanitized.suppressed
        ? 'success_suppressed'
        : sanitized.truncated
          ? 'success_truncated'
          : 'success';

      return {
        text: sanitized.text,
        metrics: this.snapshot(tracker, { outcome, latencyMs, correlationId: options.correlationId }),
      };
    } catch (err) {
      const latencyMs = this.now() - startTime;
      const { reason } = classifyGeminiError(err);
      if (reason === 'safety_blocked') tracker.safetyBlocked = true;
      err.metrics = this.snapshot(tracker, {
        outcome: err.code || reason,
        latencyMs,
        correlationId: options.correlationId,
      });
      throw err;
    }
  }

  /**
   * Generate a coaching response.
   * @param {{query: string, context: object, language: string, responseStyle?: string}} params
   * @param {{correlationId?: string}} [options]
   */
  async generateResponse({ query, context = {}, language = 'en', responseStyle = 'balanced' }, options = {}) {
    const { systemInstruction: baseInstruction, userContent } = selectTemplate(query, context);
    const directive = languageDirective(language);
    const languageInstruction = directive ? `\n\nIMPORTANT: ${directive}` : '';
    const style = styleDirective(responseStyle);
    const styleInstruction = style ? `\n\nRESPONSE STYLE: ${style}` : '';
    // Language/style directives are app-authored, not user text, so they
    // belong in systemInstruction alongside the rest of the trusted framing.
    const systemInstruction = baseInstruction + styleInstruction + languageInstruction;

    const startTime = this.now();
    const tracker = this.createTracker();

    try {
      const first = this.extractCandidate(
        await this.makeRequest(this.buildRequestBody({ systemInstruction, userText: userContent }), tracker)
      );
      let text = first.text;
      let finishReason = first.finishReason;

      // Keep asking the model to continue while it reports the answer was cut
      // off due to the token limit. Long Hindi/Indic answers can need several
      // passes. Bounded by ALL of: maxContinuations, the cumulative length
      // cap, the shared call budget, and the overall deadline — whichever is
      // reached first.
      for (
        let i = 0;
        finishReason === 'MAX_TOKENS' &&
        i < this.maxContinuations &&
        text.length < MAX_OUTPUT_LENGTH &&
        this.hasCapacity(tracker);
        i++
      ) {
        try {
          const cont = await this.fetchContinuation(text, language, systemInstruction, tracker);
          if (!cont.text.trim()) break;
          text = `${text.trim()} ${cont.text.trim()}`;
          finishReason = cont.finishReason;
        } catch {
          break; // Keep whatever we have so far.
        }
      }

      // Safety net: model reported it stopped normally but the text still
      // looks cut off mid-sentence — try a single continuation, subject to
      // the same shared budget/deadline.
      if (
        finishReason !== 'MAX_TOKENS' &&
        !this.isResponseComplete(text) &&
        text.length < MAX_OUTPUT_LENGTH &&
        this.hasCapacity(tracker)
      ) {
        try {
          const cont = await this.fetchContinuation(text, language, systemInstruction, tracker);
          if (cont.text.trim()) text = `${text.trim()} ${cont.text.trim()}`;
        } catch {
          // Keep the partial answer.
        }
      }

      const sanitized = sanitizeOutput(text, { systemInstructionText: systemInstruction });
      const latencyMs = this.now() - startTime;
      const outcome = sanitized.suppressed
        ? 'success_suppressed'
        : sanitized.truncated
          ? 'success_truncated'
          : 'success';

      return {
        text: sanitized.text,
        responseTime: latencyMs,
        timestamp: new Date().toISOString(),
        language,
        finishReason,
        truncated: sanitized.truncated,
        suppressed: sanitized.suppressed,
        metrics: this.snapshot(tracker, { outcome, latencyMs, correlationId: options.correlationId }),
      };
    } catch (err) {
      const latencyMs = this.now() - startTime;
      const { reason } = classifyGeminiError(err);
      if (reason === 'safety_blocked') tracker.safetyBlocked = true;
      // Attach metadata-only metrics to the error so the route handler can log
      // them without re-deriving. Never includes prompt/response text.
      err.metrics = this.snapshot(tracker, {
        outcome: err.code || reason,
        latencyMs,
        correlationId: options.correlationId,
      });
      throw err;
    }
  }
}

module.exports = { GeminiService };
