// Gemini LLM service: builds requests, calls the API, retries transient failures and completes truncated
// responses. The API key lives only here, server-side, from environment variables.
// Trusted, app-authored content goes in Gemini's `systemInstruction` (prompts.js) and only the teacher's raw
// question in `contents`: a real structural boundary, not string concatenation. Responses are checked for Gemini's
// own safety signals (promptFeedback.blockReason, finishReason SAFETY/RECITATION) and passed through outputGuard.
// Every fetch for one /api/coach request (initial call, every retry, every continuation and its retries) draws from
// one shared call budget (maxCallsPerRequest) and one overall deadline (totalTimeoutMs), which caps both cost and
// latency. See the per-request `tracker` created in generateResponse().

const { selectTemplate, languageDirective, styleDirective, MEMORY_DIRECTIVE } = require('./prompts');
const { sanitizeOutput, MAX_OUTPUT_LENGTH } = require('./safety/outputGuard');
const { parseRetryAfter, computeBackoffMs, classifyGeminiError } = require('./lib/geminiPolicy');
const { GeminiKeyPool } = require('./lib/geminiKeyPool');

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

// Indic scripts use many more tokens per character than English, so a low cap truncates non-English answers. Keep
// this high and rely on finishReason and continuation for long responses.
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
    // A pre-built, possibly shared GeminiKeyPool (multi-key failover) or a single apiKey wrapped in a size-1 pool,
    // which keeps single-key behaviour identical to before key rotation.
    this.keyPool = config.keyPool ?? new GeminiKeyPool([config.apiKey]);
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

  /** Heuristic: is the response text a complete thought (not truncated)? */
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
   * @param {{ systemInstruction: string, userText: string, responseSchema?: object, attachments?: Array<{mimeType: string, data: string}> }} params
   *   `responseSchema` (optional): an OpenAPI-subset schema; when present, Gemini returns `application/json`
   *   conforming to it (structured generation, see generateStructuredContent) so formatting doesn't depend on
   *   the model following Markdown instructions.
   *   `attachments` (optional): inline files (base64 `data` plus `mimeType`) added as extra `parts` in the same
   *   `contents` block as `userText`, so Gemini reasons over every file and the question together. They are untrusted
   *   user-turn content like the text; the systemInstruction/contents boundary doesn't change.
   *   `history` (optional): earlier turns as `[{role: 'user'|'model', text}]`, placed before the final user turn. Only
   *   generateResponse passes it (Coach memory); without it the body is unchanged.
   */
  buildRequestBody({ systemInstruction, userText, responseSchema, attachments, history }) {
    const generationConfig = { ...GENERATION_CONFIG, maxOutputTokens: this.maxOutputTokens };
    if (responseSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = responseSchema;
    }
    const parts = [{ text: userText }];
    for (const attachment of attachments || []) {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }
    return {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [...(history || []).map((m) => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts }],
      generationConfig,
      safetySettings: SAFETY_SETTINGS,
    };
  }

  /**
   * Create the per-request state shared by every fetch. `callsMade` counts all fetches against the single shared
   * budget, `continuations` counts continuation attempts, and `retries` counts retries across everything.
   */
  createTracker() {
    return {
      callsMade: 0,
      retries: 0,
      continuations: 0,
      keyRotations: 0,
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
      keyRotations: tracker.keyRotations,
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
   * Sleep for a backoff interval before a retry, unless that would blow the overall deadline. Returns false (and
   * marks timedOut) if the request should give up instead.
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
   * Make one logical Gemini call, retrying transient failures. Every fetch counts against the shared `tracker`
   * budget and respects the shared deadline; retries stop at whichever comes first: maxRetries, the call budget or the deadline.
   */
  async makeRequest(requestBody, tracker) {
    let attempt = 0;
    // Caps key hops per logical call; one attempt per key in the pool is enough to try everything available.
    let keyRotations = 0;
    const maxKeyRotations = this.keyPool.size();
    for (;;) {
      if (tracker.callsMade >= tracker.maxCalls) throw makeBudgetError();
      const remaining = tracker.deadline - tracker.now();
      if (remaining <= 0) {
        tracker.timedOut = true;
        throw makeDeadlineError();
      }
      const perCallTimeout = Math.min(this.timeoutMs, remaining);

      const key = this.keyPool.getKey();
      tracker.callsMade += 1;

      let response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(perCallTimeout),
        });
      } catch (fetchError) {
        // Network-level failure or per-call timeout (no HTTP status) — not a
        // key-specific problem, so no rotation, just the normal retry path.
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

        if (reason === 'rate_limited' || reason === 'auth') {
          const retryAfterMs = parseRetryAfter(
            response.headers && typeof response.headers.get === 'function'
              ? response.headers.get('retry-after')
              : null,
            tracker.now()
          );
          this.keyPool.reportFailure(key, err, { retryAfterMs });
          // The soonest any key recovers. Attached to every candidate error so whichever one propagates, once all keys and the
          // retry budget are exhausted, gives the route an accurate estimate for the client.
          err.retryAt = this.keyPool.nextAvailableAt();

          // Another key is free: switch immediately, with no backoff and no retry budget used, so the caller doesn't notice.
          // Fall through to backoff and retry only once every key is exhausted.
          if (keyRotations < maxKeyRotations && this.keyPool.hasAvailableKey() && this.hasCapacity(tracker)) {
            keyRotations += 1;
            tracker.keyRotations += 1;
            continue;
          }
        }

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

      this.keyPool.reportSuccess(key);
      return await response.json();
    }
  }

  /**
   * Extract the answer text and Gemini's finishReason. finishReason === 'MAX_TOKENS' is the authoritative sign the
   * answer was cut off at the output-token limit.
   * It also separates the two safety blocks instead of collapsing them into a generic "malformed response": the
   * input can be blocked before generation (promptFeedback.blockReason, empty candidates) or the output after it
   * (finishReason SAFETY/RECITATION). Each throws an error with a distinct `.code` so the route can show a specific
   * message. They're raised after a 200, outside the retry path, so a safety block is never retried.
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
   * Requests the rest of a cut-off response. The previous text is the model's own output but still untrusted by now,
   * so it's delimited like the teacher's question rather than trusted as instructions. The base systemInstruction
   * is carried forward so continuations follow the same rules, and the shared tracker means a continuation's
   * retries use the same budget.
   */
  async fetchContinuation(previousText, language, baseSystemInstruction, tracker) {
    tracker.continuations += 1;
    // Restated though `baseSystemInstruction` carries it: a long answer is most likely to drift back into English here.
    const languageInstruction = ` ${languageDirective(language)}`;
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
   * Generic content generation for the Lesson Plan Workspace AI actions. The caller supplies a fully formed trusted
   * systemInstruction and the delimited untrusted userText, unlike generateResponse, which builds a coaching prompt
   * from templates. It shares the per-request budget, deadline, retry, continuation and output sanitization, and
   * returns only { text, metrics }; it never persists anything.
   * @param {{systemInstruction: string, userText: string, language?: string, responseSchema?: object, attachments?: Array<{mimeType: string, data: string}>}} params
   *   `responseSchema` (optional): requests structured JSON (see buildRequestBody). The MAX_TOKENS continuation loop
   *   is then skipped: continuation resumes from a text splice, which is safe for prose but would likely produce
   *   invalid JSON, so a truncated response is left for the caller's schema validation to reject.
   *   `attachments` (optional): inline image/PDF parts in the same request (see buildRequestBody); a batch is one
   *   logical call. Sent only on the initial call; continuations stay text-only.
   * @param {{correlationId?: string}} [options]
   */
  async generateContent({ systemInstruction, userText, language = 'en', responseSchema, attachments }, options = {}) {
    const startTime = this.now();
    const tracker = this.createTracker();

    try {
      const first = this.extractCandidate(
        await this.makeRequest(this.buildRequestBody({ systemInstruction, userText, responseSchema, attachments }), tracker)
      );
      let text = first.text;
      let finishReason = first.finishReason;

      for (
        let i = 0;
        !responseSchema &&
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
   * @param {{query: string, context: object, language: string, responseStyle?: string, history?: {query: string, answer: string}[], forceEmergency?: boolean}} params
   *   `history`: earlier exchanges of the thread, oldest first (lib/conversationHistory.js). Questions are delimited like
   *   the current one; answers go back as model turns.
   * @param {{correlationId?: string}} [options]
   */
  async generateResponse(
    { query, context = {}, language = 'en', responseStyle = 'balanced', history = [], forceEmergency = false },
    options = {}
  ) {
    const { systemInstruction: selectedInstruction, userContent } = selectTemplate(query, context, { forceEmergency });
    const baseInstruction = history.length > 0 ? `${selectedInstruction}

${MEMORY_DIRECTIVE}` : selectedInstruction;
    const historyMessages = history.flatMap((e) => [
      { role: 'user', text: wrapDelimited(e.query) },
      { role: 'model', text: e.answer },
    ]);
    // Always present, English included (see languageDirective). Kept last in the instruction: the templates mandate
    // English section names ("Fun Activity 1"), and this tells the model to translate those too.
    const languageInstruction = `\n\nIMPORTANT: ${languageDirective(language)}`;
    const style = styleDirective(responseStyle);
    const styleInstruction = style ? `\n\nRESPONSE STYLE: ${style}` : '';
    // Language/style directives are app-authored, not user text, so they
    // belong in systemInstruction alongside the rest of the trusted framing.
    const systemInstruction = baseInstruction + styleInstruction + languageInstruction;

    const startTime = this.now();
    const tracker = this.createTracker();

    try {
      const first = this.extractCandidate(
        await this.makeRequest(
          this.buildRequestBody({ systemInstruction, userText: userContent, history: historyMessages }),
          tracker
        )
      );
      let text = first.text;
      let finishReason = first.finishReason;

      // Keep asking the model to continue while it reports a token-limit cutoff (long Indic answers can need several
      // passes). Bounded by whichever comes first: maxContinuations, the cumulative length cap, the call budget or the deadline.
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

      // Safety net: the model reported a normal stop but the text still looks cut off mid-sentence, so try one
      // continuation within the same budget and deadline.
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
