import { SPEECH_LOCALE } from '../config';

// Small wrapper around the Web Speech API for reading responses aloud.
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// Chrome returns an empty voice list until it has loaded them and fires 'voiceschanged'. Some browsers never fire it,
// so the wait is bounded: speech then goes ahead with the browser's default voice for the utterance's lang.
const VOICE_LOOKUP_TIMEOUT_MS = 1000;

// Android engines report both "hi-IN" and "hi_IN", so both are compared in one form.
function normalizeLocale(locale: string): string {
  return locale.toLowerCase().replace(/_/g, '-');
}

// Exact locale first, then any voice for the same language ("bn-BD" for "bn-IN"). Within a tier a voice the browser
// marks as default wins. No match returns undefined, which means "let the browser choose from utterance.lang".
function selectVoice(voices: SpeechSynthesisVoice[], locale: string): SpeechSynthesisVoice | undefined {
  const wanted = normalizeLocale(locale);
  const exact = voices.filter((v) => normalizeLocale(v.lang) === wanted);
  const pool = exact.length > 0 ? exact : voices.filter((v) => normalizeLocale(v.lang).split('-')[0] === wanted.split('-')[0]);
  return pool.find((v) => v.default) ?? pool[0];
}

// Calls `done` once with the best voice for `locale`, synchronously when the browser already has voices (so ordinary
// speech starts without a delay) and otherwise after 'voiceschanged' or the timeout. Never throws: any failure
// to read voices means "no preferred voice", not "can't speak". Returns a function that abandons a pending wait
// without calling `done`.
function lookupVoice(locale: string, done: (voice: SpeechSynthesisVoice | undefined) => void): () => void {
  const synth = window.speechSynthesis;
  const read = (): SpeechSynthesisVoice[] => {
    try {
      return synth.getVoices();
    } catch {
      return [];
    }
  };

  const initial = read();
  if (initial.length > 0) {
    done(selectVoice(initial, locale));
    return () => {};
  }

  const stopWaiting = () => {
    clearTimeout(timer);
    try {
      synth.removeEventListener('voiceschanged', settle);
    } catch {
      // Nothing was attached.
    }
  };
  const settle = () => {
    stopWaiting();
    done(selectVoice(read(), locale));
  };
  const timer = setTimeout(settle, VOICE_LOOKUP_TIMEOUT_MS);

  try {
    synth.addEventListener('voiceschanged', settle);
  } catch {
    // No event support, so there is nothing to wait for.
    clearTimeout(timer);
    done(undefined);
    return () => {};
  }
  return stopWaiting;
}

/** Resolves with the best installed voice for `locale`, or undefined if there is none or none can be read. */
export function getVoiceFor(locale: string): Promise<SpeechSynthesisVoice | undefined> {
  if (!isSpeechSupported()) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    lookupVoice(locale, resolve);
  });
}

// Some engines cut off or stall on a long utterance (Chrome with network voices, Android engines), so a response is
// spoken as a queue of chunks around this size.
const SPEECH_CHUNK_LENGTH = 200;

const SENTENCE = /\S[\s\S]*?(?:[.!?।॥]+["')\]”’]*(?=\s|$)|$)/g;
const CLAUSE = /\S[\s\S]*?(?:[,;:،…](?=\s)|$)/g;

// A list or option label ("4.", "A.", "Q1.", "१२.", "(a)") belongs to the text after it. Its dot is not a sentence end, and a
// chunk must not end on one while that text starts the next. Mid-line only A-D count (one-line MCQ options): a bare
// "5." or "B." in prose is far more often a real sentence end.
const LINE_LABEL = /^(\s*(?:\d{1,3}|[०-९]{1,3}|[A-Za-z]\d{1,3}|[A-Za-z]))\.(?=\s+\S)/;
const OPTION_LABEL = /(\s[A-D])\.(?=\s+\S)/g;
const LABEL_WORD = /^(?:\(?[A-Za-z0-9०-९]{1,3}\)|(?:\d{1,3}|[०-९]{1,3}|[A-Za-z]\d{1,3}|[A-Za-z]|Rs|No)\.)$/;
// "Rs. 45.50" and "No. 5": the dot belongs to the abbreviation, and the amount or number must be spoken with it.
const ABBREVIATION = /\b(Rs|Re|No|Fig|Eq)\.(?=\s+\d)/g;
// Stands in for a label's dot while a line is cut into sentences (a private-use code point, never real text).
const LABEL_DOT = String.fromCharCode(0xe000);

function sentencesOf(line: string): string[] {
  const masked = line.replace(LINE_LABEL, `$1${LABEL_DOT}`).replace(OPTION_LABEL, `$1${LABEL_DOT}`).replace(ABBREVIATION, `$1${LABEL_DOT}`);
  return (masked.match(SENTENCE) ?? []).map((sentence) => sentence.split(LABEL_DOT).join('.'));
}

// A piece of text already within the limit. `newLine` marks the first piece of a source line, so a chunk that spans
// lines keeps the line break between them instead of running the lines together.
interface Piece {
  text: string;
  newLine: boolean;
}

// Greedily joins pieces into chunks of at most `max` characters.
function pack(pieces: Piece[], max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const { text, newLine } of pieces) {
    if (!current) current = text;
    else if (current.length + 1 + text.length <= max) current += (newLine ? '\n' : ' ') + text;
    else {
      chunks.push(current);
      current = text;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Characters a cut must not separate from the one before them: combining marks, joiners (ZWNJ/ZWJ, real Indic joiners)
// and any char after a virama, which fuses consonants into a conjunct ("क्ष"). The virama code points are the Indic
// halant signs (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam).
const JOINERS = String.fromCharCode(0x200c, 0x200d);
const STICKS_TO_PREVIOUS = new RegExp(String.raw`[\p{M}${JOINERS}]`, 'u');
const VIRAMAS = new Set([0x94d, 0x9cd, 0xa4d, 0xacd, 0xb4d, 0xbcd, 0xc4d, 0xccd, 0xd4d].map((c) => String.fromCharCode(c)));

// Cuts a single unbreakable token, never inside a conjunct, a base letter with its marks, or a surrogate pair (Array.from
// keeps pairs whole). A cut always keeps at least one character, so it progresses.
function hardSplit(token: string, max: number): string[] {
  const chars = Array.from(token);
  const joinsPrevious = (i: number) => i < chars.length && (STICKS_TO_PREVIOUS.test(chars[i]) || VIRAMAS.has(chars[i - 1]));
  const parts: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + max, chars.length);
    while (end > start + 1 && joinsPrevious(end)) end -= 1;
    // Backed all the way to one character: take the whole cluster rather than split it.
    while (joinsPrevious(end)) end += 1;
    parts.push(chars.slice(start, end).join(''));
    start = end;
  }
  return parts;
}

// A sentence longer than `max`: split after commas and similar, then at whitespace, then (only for a single token
// longer than `max`) inside the token.
function splitLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  for (const rawClause of sentence.match(CLAUSE) ?? []) {
    // The last clause keeps any trailing whitespace of its line; a chunk must never carry it (or become empty).
    const clause = rawClause.trim();
    if (clause.length <= max) {
      if (clause) pieces.push(clause);
      continue;
    }
    const words = clause.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const next = words[i + 1];
      // A label travels with the word after it, whenever the two fit together.
      if (LABEL_WORD.test(word) && next !== undefined && word.length + 1 + next.length <= max) {
        pieces.push(`${word} ${next}`);
        i += 1;
      } else if (word.length <= max) pieces.push(word);
      else pieces.push(...hardSplit(word, max));
    }
  }
  return pack(pieces.map((text) => ({ text, newLine: false })), max);
}

// A label that ended its line with nothing after it ("4." and then the item on the next line) joins the next piece. The
// pair may exceed `max` by the label's few characters, which is well inside "roughly" and keeps the item readable.
function attachLabels(pieces: Piece[]): Piece[] {
  const joined: Piece[] = [];
  let label: Piece | null = null;
  for (const piece of pieces) {
    const merged: Piece = label ? { text: `${label.text} ${piece.text}`, newLine: label.newLine } : piece;
    if (LABEL_WORD.test(merged.text)) label = merged;
    else {
      joined.push(merged);
      label = null;
    }
  }
  if (label) joined.push(label);
  return joined;
}

/**
 * Splits text into chunks of roughly `maxLength` characters for sequential speech.
 * Whole sentences (ending at . ! ? । ॥) and lines are packed together up to the limit, so text that fits stays one
 * chunk with its line breaks. A sentence longer than the limit is split at commas, then at spaces. Words are only cut
 * when one word alone exceeds the limit. Chunks are trimmed and never empty; apart from the whitespace at the cuts,
 * all the text is kept in order.
 */
export function chunkSpeechText(text: string, maxLength: number = SPEECH_CHUNK_LENGTH): string[] {
  const max = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : SPEECH_CHUNK_LENGTH;
  const pieces: Piece[] = [];
  for (const line of text.split(/\r?\n/)) {
    const texts = sentencesOf(line).flatMap((s) => (s.length > max ? splitLongSentence(s, max) : [s.trim()])).filter(Boolean);
    texts.forEach((t, i) => pieces.push({ text: t, newLine: i === 0 }));
  }
  return pack(attachLabels(pieces), max);
}

// Why a read-aloud request failed, as opposed to being stopped or replaced on purpose.
export type SpeechFailure = 'no-voice' | 'failed';

interface SpeakOptions {
  // Called once, before onEnd, when speech genuinely failed. Never called for stop(), replacement or a browser cancel.
  onError?: (reason: SpeechFailure) => void;
}

// Returned by speak() so a caller can later stop only its own request. Opaque: compare, don't read.
export interface SpeechRequest {
  onEnd: () => void;
  // Abandons a voice lookup that is still waiting, so a replaced or stopped request leaves no listener or timer behind.
  cancelLookup?: () => void;
  // The chunk now in the engine. Held so it can't be garbage-collected before its events fire (some browsers then never
  // report the end), and dropped as soon as the chunk, the request, or its ownership is over.
  utterance?: SpeechSynthesisUtterance | null;
}

// The one request that currently owns the speech engine. The engine is a single global queue, so ownership is module
// state: a callback acts only while its request is still `active`, which makes late events from a replaced or stopped
// utterance harmless. Browsers disagree on whether cancel() fires 'end', 'error' or nothing at all, so the owner is
// notified by us rather than by whichever event the browser happens to send.
let active: SpeechRequest | null = null;

// Ends a request that lost ownership: drops its pending lookup and utterance, then tells its owner.
function release(request: SpeechRequest | null) {
  if (!request) return;
  request.cancelLookup?.();
  request.utterance = null;
  request.onEnd();
}

// SpeechSynthesisErrorEvent.error values that mean "someone cancelled this", not "it broke".
const INTENTIONAL_ERRORS = new Set(['interrupted', 'canceled']);
const NO_VOICE_ERRORS = new Set(['language-unavailable', 'voice-unavailable']);

function cancelSpeech() {
  try {
    window.speechSynthesis.cancel();
  } catch {
    // A throwing cancel() leaves nothing for us to clean up; the active request is already invalidated.
  }
}

/**
 * Reads `text` aloud, replacing any speech already in progress.
 * `onEnd` is called exactly once when this request is over: it finished, failed, was stopped, or was replaced by a
 * later speak(). A request that fails also calls `options.onError` first.
 */
export function speak(text: string, language: string, onEnd: () => void, options: SpeakOptions = {}): SpeechRequest | null {
  if (!isSpeechSupported()) return null;

  const owner: SpeechRequest = { onEnd };
  const previous = active;
  // Installed before cancelling, so any event the cancel triggers for the old utterance finds a different owner.
  active = owner;
  cancelSpeech();
  release(previous);

  // No-ops once this request is no longer the active one, whichever event gets here first.
  const finish = (failure?: SpeechFailure) => {
    if (active !== owner) return;
    active = null;
    owner.utterance = null;
    if (failure) options.onError?.(failure);
    onEnd();
  };

  const locale = SPEECH_LOCALE[language] || 'en-US';
  const chunks = chunkSpeechText(text);

  // Speaks chunk `index`; its end speaks the next, and the last one's end finishes the request. Only one chunk is ever
  // queued in the engine, so stopping or replacing the request has nothing left behind to cancel.
  const speakChunk = (index: number, voice: SpeechSynthesisVoice | undefined) => {
    // A lookup or an earlier chunk can outlive the request (replaced or stopped meanwhile): never speak for it then.
    if (active !== owner) return;
    try {
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = locale;
      // No matching voice is not an error: lang alone lets the browser choose, and it reports a real gap itself.
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      // A chunk reacts to its first event only: a repeated or late 'end'/'error' must not advance the queue twice.
      let settled = false;
      const settle = (): boolean => {
        if (settled || active !== owner) return false;
        settled = true;
        return true;
      };
      utterance.onend = () => {
        if (!settle()) return;
        if (index + 1 < chunks.length) speakChunk(index + 1, voice);
        else finish();
      };
      utterance.onerror = (event) => {
        if (!settle()) return;
        const reason = event?.error;
        if (reason && INTENTIONAL_ERRORS.has(reason)) finish();
        else finish(reason && NO_VOICE_ERRORS.has(reason) ? 'no-voice' : 'failed');
      };
      owner.utterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch {
      finish('failed');
    }
  };

  const start = (voice: SpeechSynthesisVoice | undefined) => {
    if (active !== owner) return;
    // Nothing readable (empty or whitespace only): there is nothing to say and nothing wrong, so just end.
    if (chunks.length === 0) finish();
    else speakChunk(0, voice);
  };

  // Assigned after the call: a lookup that finishes synchronously has nothing left to cancel.
  owner.cancelLookup = lookupVoice(locale, start);
  return owner;
}

/**
 * Stops the current read-aloud, if any, and tells its owner it ended.
 * Pass what speak() returned to stop only that request: it does nothing if the request already ended or was replaced,
 * so one component cleaning up can't cut off speech another has since started. With no argument it stops anything.
 */
export function stopSpeaking(request?: SpeechRequest | null) {
  if (!isSpeechSupported()) return;
  if (request !== undefined && active !== request) return;
  const previous = active;
  // Invalidate first so events from the cancelled utterance can't reach a request started afterwards.
  active = null;
  cancelSpeech();
  release(previous);
}
