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

const { selectTemplate, languageDirective, styleDirective } = require('./prompts');
const { sanitizeOutput, MAX_OUTPUT_LENGTH } = require('./safety/outputGuard');

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  // Devanagari and other Indic scripts consume many more tokens per character
  // than English, so a low cap truncates non-English answers. Keep this high
  // and rely on finishReason + continuation to complete long responses.
  maxOutputTokens: 8192,
};

/** Wraps text in triple-backtick delimiters for a user-turn content block. */
function wrapDelimited(text) {
  return '```\n' + text + '\n```';
}

class GeminiService {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const endsWithOpenList = /[:\-]\s*$/.test(trimmed);
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
      generationConfig: GENERATION_CONFIG,
      safetySettings: SAFETY_SETTINGS,
    };
  }

  async makeRequest(requestBody, retryCount = 0) {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Gemini API error: ${response.status}`);
        err.status = response.status;
        err.details = errorText;
        throw err;
      }

      return await response.json();
    } catch (error) {
      const retriable = !error.status || error.status >= 500 || error.status === 429;
      if (retriable && retryCount < this.maxRetries) {
        await this.delay(1000 * (retryCount + 1));
        return this.makeRequest(requestBody, retryCount + 1);
      }
      throw error;
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
   * specific message instead of a generic failure.
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
   * original request.
   */
  async fetchContinuation(previousText, language, baseSystemInstruction) {
    const directive = languageDirective(language);
    const languageInstruction = directive ? ` ${directive}` : '';
    const continuationSystemInstruction = `${baseSystemInstruction}

CONTINUATION TASK:
You are continuing a response that was cut off mid-way. The text already written is provided next as user content, delimited by triple backticks. Continue EXACTLY from where it stopped. Do NOT repeat any earlier text, do NOT restart, and do NOT add any preamble — output only the remaining part of the answer.${languageInstruction}`;

    const response = await this.makeRequest(
      this.buildRequestBody({
        systemInstruction: continuationSystemInstruction,
        userText: wrapDelimited(previousText),
      })
    );
    return this.extractCandidate(response);
  }

  /**
   * Generate a coaching response.
   * @param {{query: string, context: object, language: string, responseStyle?: string}} params
   */
  async generateResponse({ query, context = {}, language = 'en', responseStyle = 'balanced' }) {
    const { systemInstruction: baseInstruction, userContent } = selectTemplate(query, context);
    const directive = languageDirective(language);
    const languageInstruction = directive ? `\n\nIMPORTANT: ${directive}` : '';
    const style = styleDirective(responseStyle);
    const styleInstruction = style ? `\n\nRESPONSE STYLE: ${style}` : '';
    // Language/style directives are app-authored, not user text, so they
    // belong in systemInstruction alongside the rest of the trusted framing.
    const systemInstruction = baseInstruction + styleInstruction + languageInstruction;

    const startTime = Date.now();
    const first = this.extractCandidate(
      await this.makeRequest(this.buildRequestBody({ systemInstruction, userText: userContent }))
    );
    let text = first.text;
    let finishReason = first.finishReason;

    // Keep asking the model to continue while it reports the answer was cut off
    // due to the token limit. Long Hindi/Indic answers can need several passes.
    // Also stops early once accumulated text already reaches the safety
    // length cap, so an adversarial or unusually long exchange can't run up
    // an unbounded number of extra Gemini calls.
    const MAX_CONTINUATIONS = 4;
    for (let i = 0; finishReason === 'MAX_TOKENS' && i < MAX_CONTINUATIONS && text.length < MAX_OUTPUT_LENGTH; i++) {
      try {
        const cont = await this.fetchContinuation(text, language, systemInstruction);
        if (!cont.text.trim()) break;
        text = `${text.trim()} ${cont.text.trim()}`;
        finishReason = cont.finishReason;
      } catch {
        break; // Keep whatever we have so far.
      }
    }

    // Safety net: model reported it stopped normally but the text still looks
    // cut off mid-sentence — try a single continuation.
    if (finishReason !== 'MAX_TOKENS' && !this.isResponseComplete(text) && text.length < MAX_OUTPUT_LENGTH) {
      try {
        const cont = await this.fetchContinuation(text, language, systemInstruction);
        if (cont.text.trim()) text = `${text.trim()} ${cont.text.trim()}`;
      } catch {
        // Keep the partial answer.
      }
    }

    const sanitized = sanitizeOutput(text, { systemInstructionText: systemInstruction });

    return {
      text: sanitized.text,
      responseTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      language,
      finishReason,
      truncated: sanitized.truncated,
      suppressed: sanitized.suppressed,
    };
  }
}

module.exports = { GeminiService };
