import { afterEach, describe, expect, it, vi } from 'vitest';
import { chunkSpeechText, getVoiceFor, isSpeechSupported, speak, stopSpeaking, type SpeechRequest } from './tts';

// jsdom has no speech engine, so these tests stand in a fake one. The fake fires nothing on its own: each test triggers
// the events a real browser would, because which event cancel() produces is exactly what differs between browsers.
class FakeUtterance {
  text: string;
  lang = '';
  voice: unknown = null;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface FakeSynth {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  spoken: FakeUtterance[];
  voices: SpeechSynthesisVoice[];
  listeners: Set<() => void>;
  // Fires 'voiceschanged' the way a browser does once its voice list has loaded.
  emitVoicesChanged: () => void;
}

function voice(lang: string, extra: { default?: boolean; name?: string } = {}): SpeechSynthesisVoice {
  return { lang, name: extra.name ?? lang, default: extra.default ?? false, localService: true, voiceURI: lang } as SpeechSynthesisVoice;
}

// `onCancel` runs inside cancel(), with the utterance that was current, to mimic a browser that fires an event for it.
// By default one English voice is installed, so a request for another language finds no match but voices are "loaded".
function installSynth(onCancel?: (u: FakeUtterance) => void, voices: SpeechSynthesisVoice[] = [voice('en-US')]): FakeSynth {
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  const synth: FakeSynth = {
    spoken,
    voices,
    listeners,
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
    }),
    cancel: vi.fn(() => {
      const current = spoken[spoken.length - 1];
      if (current && onCancel) onCancel(current);
    }),
    getVoices: vi.fn(() => synth.voices),
    addEventListener: vi.fn((_type: string, fn: () => void) => {
      listeners.add(fn);
    }),
    removeEventListener: vi.fn((_type: string, fn: () => void) => {
      listeners.delete(fn);
    }),
    emitVoicesChanged: () => [...listeners].forEach((fn) => fn()),
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

afterEach(() => {
  // Module state outlives a test: end any request still active before the next one starts.
  if (isSpeechSupported()) stopSpeaking();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('tts: support and setup', () => {
  it('does nothing and never calls back when speech is unsupported', () => {
    const onEnd = vi.fn();
    expect(isSpeechSupported()).toBe(false);
    expect(() => speak('hello', 'en', onEnd)).not.toThrow();
    expect(() => stopSpeaking()).not.toThrow();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('speaks with the response language locale and the existing rate', () => {
    const synth = installSynth();
    speak('नमस्ते', 'hi', vi.fn());
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]).toMatchObject({ text: 'नमस्ते', lang: 'hi-IN', rate: 0.95 });
  });

  it('falls back to en-US for an unknown language', () => {
    const synth = installSynth();
    speak('hi', 'xx', vi.fn());
    expect(synth.spoken[0].lang).toBe('en-US');
  });
});

describe('tts: normal completion', () => {
  it('calls onEnd once when speech finishes, even if end fires twice', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    speak('a', 'en', onEnd);
    synth.spoken[0].onend?.();
    synth.spoken[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('tts: overlapping requests', () => {
  it('tells the first owner it ended when a second request starts, even if the browser fires no event', () => {
    const synth = installSynth();
    const endA = vi.fn();
    const endB = vi.fn();
    speak('a', 'en', endA);
    speak('b', 'en', endB);
    expect(synth.cancel).toHaveBeenCalled();
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).not.toHaveBeenCalled();
    expect(synth.spoken).toHaveLength(2);
  });

  it('ignores a late end from the replaced utterance', () => {
    const synth = installSynth();
    const endA = vi.fn();
    const endB = vi.fn();
    speak('a', 'en', endA);
    speak('b', 'en', endB);
    synth.spoken[0].onend?.();
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).not.toHaveBeenCalled();
  });

  it('ignores a late error from the replaced utterance, silently or not', () => {
    const synth = installSynth();
    const onErrorA = vi.fn();
    const endB = vi.fn();
    const onErrorB = vi.fn();
    speak('a', 'en', vi.fn(), { onError: onErrorA });
    speak('b', 'en', endB, { onError: onErrorB });
    synth.spoken[0].onerror?.({ error: 'interrupted' });
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(onErrorA).not.toHaveBeenCalled();
    expect(onErrorB).not.toHaveBeenCalled();
    expect(endB).not.toHaveBeenCalled();
  });

  it('keeps the new request intact when cancel() fires an interrupted error for the old one', () => {
    const synth = installSynth((u) => u.onerror?.({ error: 'interrupted' }));
    const endA = vi.fn();
    const onErrorA = vi.fn();
    const endB = vi.fn();
    speak('a', 'en', endA, { onError: onErrorA });
    speak('b', 'en', endB);
    expect(endA).toHaveBeenCalledTimes(1);
    expect(onErrorA).not.toHaveBeenCalled();
    expect(endB).not.toHaveBeenCalled();
    synth.spoken[1].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
  });

  it('keeps the new request intact when cancel() fires an end event for the old one', () => {
    installSynth((u) => u.onend?.());
    const endA = vi.fn();
    const endB = vi.fn();
    speak('a', 'en', endA);
    speak('b', 'en', endB);
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).not.toHaveBeenCalled();
  });

  it('lets an onEnd that starts new speech keep that speech', () => {
    const synth = installSynth();
    const endB = vi.fn();
    speak('a', 'en', () => speak('b', 'en', endB));
    stopSpeaking();
    expect(synth.spoken.map((u) => u.text)).toEqual(['a', 'b']);
    synth.spoken[1].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
  });
});

describe('tts: stopSpeaking', () => {
  it('cancels the engine and ends the owner exactly once', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    speak('a', 'en', onEnd);
    stopSpeaking();
    expect(synth.cancel).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores events from the stopped utterance afterwards', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak('a', 'en', onEnd, { onError });
    stopSpeaking();
    synth.spoken[0].onend?.();
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not double-notify when cancel() itself fires an event', () => {
    installSynth((u) => u.onerror?.({ error: 'canceled' }));
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak('a', 'en', onEnd, { onError });
    stopSpeaking();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('invalidates the request before cancelling, so a new request started later is unaffected', () => {
    const synth = installSynth((u) => u.onend?.());
    const endA = vi.fn();
    const endB = vi.fn();
    speak('a', 'en', endA);
    stopSpeaking();
    speak('b', 'en', endB);
    synth.spoken[0].onend?.();
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).not.toHaveBeenCalled();
  });

  it('is a harmless no-op when nothing is speaking', () => {
    installSynth();
    expect(() => stopSpeaking()).not.toThrow();
  });
});

describe('tts: cancellation versus genuine errors', () => {
  it.each(['interrupted', 'canceled'])('treats a "%s" error as a silent end', (error) => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak('a', 'en', onEnd, { onError });
    synth.spoken[0].onerror?.({ error });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a genuine error once, before onEnd', () => {
    const synth = installSynth();
    const calls: string[] = [];
    speak('a', 'en', () => calls.push('end'), { onError: (r) => calls.push(`error:${r}`) });
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(calls).toEqual(['error:failed', 'end']);
  });

  it.each(['language-unavailable', 'voice-unavailable'])('maps "%s" to no-voice', (error) => {
    const synth = installSynth();
    const onError = vi.fn();
    speak('a', 'en', vi.fn(), { onError });
    synth.spoken[0].onerror?.({ error });
    expect(onError).toHaveBeenCalledWith('no-voice');
  });

  it('treats an error with no reason as a failure', () => {
    const synth = installSynth();
    const onError = vi.fn();
    speak('a', 'en', vi.fn(), { onError });
    synth.spoken[0].onerror?.({});
    expect(onError).toHaveBeenCalledWith('failed');
  });

  it('still ends the request on a genuine error when the caller passed no onError', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    speak('a', 'en', onEnd);
    synth.spoken[0].onerror?.({ error: 'audio-busy' });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('tts: synchronous exceptions', () => {
  it('reports a failure, not a throw, when the engine speak() throws', () => {
    const synth = installSynth();
    synth.speak.mockImplementation(() => {
      throw new Error('boom');
    });
    const onEnd = vi.fn();
    const onError = vi.fn();
    expect(() => speak('a', 'en', onEnd, { onError })).not.toThrow();
    expect(onError).toHaveBeenCalledWith('failed');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reports a failure when the utterance cannot be constructed', () => {
    installSynth();
    vi.stubGlobal('SpeechSynthesisUtterance', function Broken() {
      throw new Error('no utterance');
    });
    const onEnd = vi.fn();
    const onError = vi.fn();
    expect(() => speak('a', 'en', onEnd, { onError })).not.toThrow();
    expect(onError).toHaveBeenCalledWith('failed');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('still speaks when cancel() throws', () => {
    const synth = installSynth();
    speak('a', 'en', vi.fn());
    synth.cancel.mockImplementation(() => {
      throw new Error('cancel failed');
    });
    const endB = vi.fn();
    expect(() => speak('b', 'en', endB)).not.toThrow();
    expect(synth.spoken).toHaveLength(2);
    expect(endB).not.toHaveBeenCalled();
  });

  it('does not let a failed request affect the next one', () => {
    const synth = installSynth();
    speak('a', 'en', vi.fn());
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    const endB = vi.fn();
    speak('b', 'en', endB);
    synth.spoken[1].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
  });
});

describe('tts: voice selection', () => {
  it('prefers an exact locale match over a same-language voice', () => {
    const exact = voice('hi-IN', { name: 'exact' });
    const synth = installSynth(undefined, [voice('hi-US', { default: true }), exact]);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken[0].voice).toBe(exact);
  });

  it('falls back to a voice for the same language when the locale is not installed', () => {
    const bangladesh = voice('bn-BD');
    const synth = installSynth(undefined, [voice('en-US'), bangladesh]);
    speak('a', 'bn', vi.fn());
    expect(synth.spoken[0].voice).toBe(bangladesh);
  });

  it('prefers the default voice among exact matches', () => {
    const preferred = voice('hi-IN', { default: true, name: 'preferred' });
    const synth = installSynth(undefined, [voice('hi-IN', { name: 'first' }), preferred]);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken[0].voice).toBe(preferred);
  });

  it('prefers the default voice among same-language fallbacks', () => {
    const preferred = voice('hi-XX', { default: true });
    const synth = installSynth(undefined, [voice('hi-YY'), preferred]);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken[0].voice).toBe(preferred);
  });

  it('takes the first match when none is marked default', () => {
    const first = voice('ta-IN', { name: 'first' });
    const synth = installSynth(undefined, [first, voice('ta-IN', { name: 'second' })]);
    speak('a', 'ta', vi.fn());
    expect(synth.spoken[0].voice).toBe(first);
  });

  it('matches regardless of case and of "_" versus "-" in the voice language', () => {
    const underscored = voice('hi_IN');
    const synth = installSynth(undefined, [underscored]);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken[0].voice).toBe(underscored);
  });

  it('does not match a different language that merely shares a prefix', () => {
    const synth = installSynth(undefined, [voice('hil-PH')]);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken[0].voice).toBeNull();
  });

  it('still speaks, with the browser default voice and no error, when nothing matches', () => {
    const synth = installSynth(undefined, [voice('en-US')]);
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak('a', 'hi', onEnd, { onError });
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice).toBeNull();
    expect(synth.spoken[0].lang).toBe('hi-IN');
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('starts synchronously when voices are already loaded', () => {
    const synth = installSynth(undefined, [voice('hi-IN')]);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken).toHaveLength(1);
    expect(synth.addEventListener).not.toHaveBeenCalled();
  });
});

describe('tts: waiting for voices to load', () => {
  it('waits while the voice list is empty, then speaks with the voice that loads', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    expect(synth.spoken).toHaveLength(0);
    const hindi = voice('hi-IN');
    synth.voices = [voice('en-US'), hindi];
    synth.emitVoicesChanged();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice).toBe(hindi);
  });

  it('removes its listener and timer once voices arrive, and never speaks twice', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    synth.voices = [voice('hi-IN')];
    synth.emitVoicesChanged();
    expect(synth.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(synth.spoken).toHaveLength(1);
  });

  it('speaks with the default voice when voiceschanged fires but the list is still empty', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    synth.emitVoicesChanged();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice).toBeNull();
  });

  it('gives up after about a second when voiceschanged never fires', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const onError = vi.fn();
    speak('a', 'hi', vi.fn(), { onError });
    vi.advanceTimersByTime(999);
    expect(synth.spoken).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice).toBeNull();
    expect(synth.spoken[0].lang).toBe('hi-IN');
    expect(onError).not.toHaveBeenCalled();
  });

  it('cleans up its listener after a timeout, and a late voiceschanged does nothing', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    vi.advanceTimersByTime(1000);
    expect(synth.listeners.size).toBe(0);
    synth.voices = [voice('hi-IN')];
    synth.emitVoicesChanged();
    expect(synth.spoken).toHaveLength(1);
  });

  it('uses a voice that appeared without an event when the timeout fires', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    const hindi = voice('hi-IN');
    synth.voices = [hindi];
    vi.advanceTimersByTime(1000);
    expect(synth.spoken[0].voice).toBe(hindi);
  });

  it('does not wait when the browser has no voiceschanged support', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    synth.addEventListener.mockImplementation(() => {
      throw new Error('unsupported');
    });
    speak('a', 'hi', vi.fn());
    expect(synth.spoken).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('speaks with the default voice, without an error, when reading voices throws', () => {
    const synth = installSynth(undefined, []);
    synth.getVoices.mockImplementation(() => {
      throw new Error('no voices');
    });
    synth.addEventListener.mockImplementation(() => {
      throw new Error('unsupported');
    });
    const onError = vi.fn();
    speak('a', 'hi', vi.fn(), { onError });
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('speaks with the default voice when reading voices throws after the event', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    synth.getVoices.mockImplementation(() => {
      throw new Error('no voices');
    });
    synth.emitVoicesChanged();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].voice).toBeNull();
  });

  it('still reports a genuine engine error that happens after a delayed start', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak('a', 'hi', onEnd, { onError });
    vi.advanceTimersByTime(1000);
    synth.spoken[0].onerror?.({ error: 'language-unavailable' });
    expect(onError).toHaveBeenCalledWith('no-voice');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('keeps a synchronous speak() failure after a delayed start a plain failure', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    synth.speak.mockImplementation(() => {
      throw new Error('boom');
    });
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak('a', 'hi', onEnd, { onError });
    vi.advanceTimersByTime(1000);
    expect(onError).toHaveBeenCalledWith('failed');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('tts: replacement and stop while voices are loading', () => {
  it('never speaks a request that was stopped during the lookup, and cleans up', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const onEnd = vi.fn();
    speak('a', 'hi', onEnd);
    stopSpeaking();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(synth.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    synth.voices = [voice('hi-IN')];
    synth.emitVoicesChanged();
    vi.advanceTimersByTime(5000);
    expect(synth.spoken).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('speaks only the newer request when a second one replaces a pending lookup', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const endA = vi.fn();
    const endB = vi.fn();
    speak('a', 'hi', endA);
    speak('b', 'hi', endB);
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).not.toHaveBeenCalled();
    expect(synth.listeners.size).toBe(1);
    synth.voices = [voice('hi-IN')];
    synth.emitVoicesChanged();
    expect(synth.spoken.map((u) => u.text)).toEqual(['b']);
    vi.advanceTimersByTime(5000);
    expect(synth.spoken).toHaveLength(1);
  });

  it('does not let the replaced lookup overwrite the newer request callbacks', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const endA = vi.fn();
    const endB = vi.fn();
    const errorA = vi.fn();
    const errorB = vi.fn();
    speak('a', 'hi', endA, { onError: errorA });
    speak('b', 'hi', endB, { onError: errorB });
    vi.advanceTimersByTime(1000);
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(errorA).not.toHaveBeenCalled();
    expect(errorB).toHaveBeenCalledWith('failed');
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).toHaveBeenCalledTimes(1);
  });

  it('lets a request started after a stopped pending one speak normally', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    stopSpeaking();
    const endB = vi.fn();
    speak('b', 'hi', endB);
    vi.advanceTimersByTime(1000);
    expect(synth.spoken.map((u) => u.text)).toEqual(['b']);
    synth.spoken[0].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
  });

  it('replaces a pending lookup with a request that can start immediately', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const endA = vi.fn();
    speak('a', 'hi', endA);
    synth.voices = [voice('hi-IN')];
    const endB = vi.fn();
    speak('b', 'hi', endB);
    expect(synth.spoken.map((u) => u.text)).toEqual(['b']);
    expect(endA).toHaveBeenCalledTimes(1);
    expect(synth.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the engine when a request begins, before its voice is known', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak('a', 'hi', vi.fn());
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('tts: getVoiceFor', () => {
  it('resolves undefined when speech is unsupported', async () => {
    await expect(getVoiceFor('hi-IN')).resolves.toBeUndefined();
  });

  it('resolves immediately with the best installed voice', async () => {
    const hindi = voice('hi-IN');
    installSynth(undefined, [voice('en-US'), hindi]);
    await expect(getVoiceFor('hi-IN')).resolves.toBe(hindi);
  });

  it('resolves undefined when no voice fits', async () => {
    installSynth(undefined, [voice('en-US')]);
    await expect(getVoiceFor('hi-IN')).resolves.toBeUndefined();
  });

  it('waits for voiceschanged', async () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const result = getVoiceFor('hi-IN');
    const hindi = voice('hi-IN');
    synth.voices = [hindi];
    synth.emitVoicesChanged();
    await expect(result).resolves.toBe(hindi);
    expect(synth.listeners.size).toBe(0);
  });

  it('resolves undefined on timeout', async () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const result = getVoiceFor('hi-IN');
    vi.advanceTimersByTime(1000);
    await expect(result).resolves.toBeUndefined();
    expect(synth.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('tts: stopping only your own request', () => {
  it('returns null from speak() when speech is unsupported', () => {
    expect(speak('a', 'en', vi.fn())).toBeNull();
  });

  it('stops the request it was given', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const request = speak('a', 'en', onEnd);
    stopSpeaking(request);
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the given request was replaced by a newer one', () => {
    const synth = installSynth();
    const first = speak('a', 'en', vi.fn());
    const endB = vi.fn();
    speak('b', 'en', endB);
    synth.cancel.mockClear();
    stopSpeaking(first);
    expect(synth.cancel).not.toHaveBeenCalled();
    expect(endB).not.toHaveBeenCalled();
    synth.spoken[1].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the given request already finished', () => {
    const synth = installSynth();
    const first = speak('a', 'en', vi.fn());
    synth.spoken[0].onend?.();
    const endB = vi.fn();
    speak('b', 'en', endB);
    stopSpeaking(first);
    expect(endB).not.toHaveBeenCalled();
  });

  it('does nothing for a null request even while another request is speaking', () => {
    installSynth();
    const endA = vi.fn();
    speak('a', 'en', endA);
    stopSpeaking(null);
    expect(endA).not.toHaveBeenCalled();
  });

  it('stops a request whose voice lookup is still pending, with no later speech', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    const onEnd = vi.fn();
    const request = speak('a', 'hi', onEnd);
    stopSpeaking(request);
    vi.advanceTimersByTime(5000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(synth.spoken).toHaveLength(0);
  });

  it('still stops everything when called with no argument', () => {
    installSynth();
    const onEnd = vi.fn();
    speak('a', 'en', onEnd);
    stopSpeaking();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

const noSpace = (s: string) => s.replace(/\s+/g, '');

describe('chunkSpeechText: boundaries', () => {
  it('keeps short text as a single chunk', () => {
    expect(chunkSpeechText('Hello world.')).toEqual(['Hello world.']);
    expect(chunkSpeechText('No end punctuation at all')).toEqual(['No end punctuation at all']);
  });

  it('trims, and returns nothing for empty or whitespace-only input', () => {
    expect(chunkSpeechText('  Hello.  ')).toEqual(['Hello.']);
    expect(chunkSpeechText('')).toEqual([]);
    expect(chunkSpeechText('   \n\n \t ')).toEqual([]);
  });

  it('keeps short multi-line text as one chunk with its line breaks', () => {
    expect(chunkSpeechText('Heading.\nBody text.')).toEqual(['Heading.\nBody text.']);
  });

  it('starts a new chunk at a line boundary when the next line would not fit', () => {
    expect(chunkSpeechText('First line here.\nSecond line here.', 20)).toEqual(['First line here.', 'Second line here.']);
  });

  it('packs whole sentences up to the limit and cuts between them', () => {
    expect(chunkSpeechText('One two three. Four five six. Seven eight nine.', 30)).toEqual([
      'One two three. Four five six.',
      'Seven eight nine.',
    ]);
  });

  it('splits on ! and ? as well as full stops', () => {
    expect(chunkSpeechText('Why now? Because! Done.', 10)).toEqual(['Why now?', 'Because!', 'Done.']);
  });

  it('does not cut inside a decimal number', () => {
    const chunks = chunkSpeechText('The value is 3.5 cm. Next one.', 22);
    expect(chunks).toEqual(['The value is 3.5 cm.', 'Next one.']);
  });

  it('keeps an abbreviation attached to what follows when they fit together', () => {
    expect(chunkSpeechText('Dr. Rao teaches. Next.', 40)).toEqual(['Dr. Rao teaches. Next.']);
  });

  it('keeps a closing quote with its sentence', () => {
    expect(chunkSpeechText('He said "stop." Then left.', 16)).toEqual(['He said "stop."', 'Then left.']);
  });
});

describe('chunkSpeechText: Hindi and Devanagari', () => {
  const HINDI = 'यह पहला वाक्य है। यह दूसरा वाक्य है॥ और तीसरा।';

  it('splits at the danda and double danda', () => {
    expect(chunkSpeechText(HINDI, 20)).toEqual(['यह पहला वाक्य है।', 'यह दूसरा वाक्य है॥', 'और तीसरा।']);
  });

  it('keeps short Hindi text whole', () => {
    expect(chunkSpeechText(HINDI)).toEqual([HINDI]);
  });

  it('keeps Devanagari digits and conjuncts intact', () => {
    const text = 'कक्षा १२ में ३५ छात्र हैं। क्षत्रिय और ज्ञान का अर्थ समझाएँ।';
    const chunks = chunkSpeechText(text, 25);
    expect(chunks.join(' ')).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits an over-long Hindi sentence at commas and spaces without losing words', () => {
    const text = 'पहला बिंदु समझाएँ, दूसरा बिंदु लिखें, तीसरा बिंदु बोर्ड पर बनाएँ, चौथा बिंदु दोहराएँ';
    const chunks = chunkSpeechText(text, 25);
    expect(chunks.every((c) => c.length <= 25)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('never cuts inside a conjunct or before a combining mark when it must split a long token', () => {
    const token = 'क्षत्रिय'.repeat(8);
    const chunks = chunkSpeechText(token, 10);
    expect(chunks.join('')).toBe(token);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
      expect(chunk).not.toMatch(/^[\p{M}]/u);
      expect(chunk).not.toMatch(/्$/);
    }
  });
});

describe('chunkSpeechText: long sentences', () => {
  it('splits an over-long sentence after commas first', () => {
    const text = 'alpha beta gamma, delta epsilon zeta, eta theta iota, kappa lambda mu';
    expect(chunkSpeechText(text, 30)).toEqual([
      'alpha beta gamma,',
      'delta epsilon zeta,',
      'eta theta iota,',
      'kappa lambda mu',
    ]);
  });

  it('falls back to spaces when there are no commas, keeping every word whole', () => {
    expect(chunkSpeechText('one two three four five six seven eight nine ten', 15)).toEqual([
      'one two three',
      'four five six',
      'seven eight',
      'nine ten',
    ]);
  });

  it('cuts a single token longer than the limit, and only that token', () => {
    expect(chunkSpeechText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
    expect(chunkSpeechText('ok ' + 'y'.repeat(12) + ' end', 8)).toEqual(['ok', 'yyyyyyyy', 'yyyy end']);
  });

  it('does not split an emoji surrogate pair', () => {
    const chunks = chunkSpeechText('😀'.repeat(6), 3);
    expect(chunks.join('')).toBe('😀'.repeat(6));
    expect(chunks.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c))).toBe(true);
  });

  it('always makes progress, even with a tiny or invalid limit', () => {
    expect(chunkSpeechText('ab cd', 1)).toEqual(['a', 'b', 'c', 'd']);
    for (const bad of [0, -5, 0.4]) expect(chunkSpeechText('ab cd', bad)).toEqual(['a', 'b', 'c', 'd']);
    expect(chunkSpeechText('ab cd', NaN)).toEqual(['ab cd']);
  });
});

describe('chunkSpeechText: nothing lost, nothing empty', () => {
  const CORPUS = [
    'Short one.',
    'Heading.\nFirst item here, with a comma.\nSecond item: another clause; and one more thing!\n\nNew paragraph. Ends?',
    'यह एक वाक्य है। दूसरा, तीसरा; चौथा॥\n१. पहला कदम\n२. दूसरा कदम',
    'Aaj ka topic hai fractions. Bachon ko roti ka example do, phir paper fold karwao, aur poochho: kitne hisse bane?',
    'A very long sentence without any punctuation that just keeps going and going for quite a while so that it has to be cut by words alone',
    'Mixed 3.5 and 2.75 values, e.g. one half (0.5) or "quoted text." Then more words follow here.',
    'supercalifragilisticexpialidocious '.repeat(4),
  ];

  for (const max of [10, 17, 40, 200]) {
    it(`keeps all text, in order, with no empty or untrimmed chunks (limit ${max})`, () => {
      for (const text of CORPUS) {
        const chunks = chunkSpeechText(text, max);
        expect(noSpace(chunks.join(''))).toBe(noSpace(text));
        for (const chunk of chunks) {
          expect(chunk).not.toBe('');
          expect(chunk).toBe(chunk.trim());
          expect(chunk.length).toBeLessThanOrEqual(max);
        }
      }
    });
  }
});

describe('tts: sequential chunk playback', () => {
  // 20 sentences of 26-27 characters: three chunks at the 200-character target.
  const LONG = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const CHUNKS = chunkSpeechText(LONG);

  it('has a long fixture that really spans several chunks', () => {
    expect(CHUNKS.length).toBeGreaterThanOrEqual(3);
    expect(CHUNKS.every((c) => c.length <= 200)).toBe(true);
    expect(CHUNKS.join(' ')).toBe(LONG);
  });

  it('keeps short text as one utterance with its exact text, ending on the first end', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    speak('Use a roti.', 'en', onEnd);
    expect(synth.spoken.map((u) => u.text)).toEqual(['Use a roti.']);
    synth.spoken[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('speaks one chunk at a time and starts the next only when the current one ends', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    speak(LONG, 'en', onEnd);
    expect(synth.spoken.map((u) => u.text)).toEqual([CHUNKS[0]]);
    synth.spoken[0].onend?.();
    expect(synth.spoken.map((u) => u.text)).toEqual([CHUNKS[0], CHUNKS[1]]);
    expect(onEnd).not.toHaveBeenCalled();
    synth.spoken[1].onend?.();
    synth.spoken[2].onend?.();
    expect(synth.spoken.map((u) => u.text)).toEqual(CHUNKS);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('gives every chunk the same locale, rate and voice', () => {
    const hindi = voice('hi-IN');
    const synth = installSynth(undefined, [voice('en-US'), hindi]);
    speak(LONG, 'hi', vi.fn());
    for (let i = 0; i < CHUNKS.length; i++) synth.spoken[i].onend?.();
    expect(synth.spoken).toHaveLength(CHUNKS.length);
    for (const u of synth.spoken) expect(u).toMatchObject({ lang: 'hi-IN', rate: 0.95, voice: hindi });
  });

  it('uses the voice found after a pending lookup for every chunk', () => {
    vi.useFakeTimers();
    const synth = installSynth(undefined, []);
    speak(LONG, 'hi', vi.fn());
    const hindi = voice('hi-IN');
    synth.voices = [hindi];
    synth.emitVoicesChanged();
    for (let i = 0; i < CHUNKS.length; i++) synth.spoken[i].onend?.();
    expect(synth.spoken.map((u) => u.voice)).toEqual(CHUNKS.map(() => hindi));
  });

  it('ends once, without speaking, for empty or whitespace-only input', () => {
    const synth = installSynth();
    for (const text of ['', '   \n  ']) {
      const onEnd = vi.fn();
      const onError = vi.fn();
      expect(speak(text, 'en', onEnd, { onError })).not.toBeNull();
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    }
    expect(synth.spoken).toHaveLength(0);
  });

  it('calls onEnd exactly once however many extra events arrive', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak(LONG, 'en', onEnd, { onError });
    for (let i = 0; i < CHUNKS.length; i++) {
      synth.spoken[i].onend?.();
      synth.spoken[i].onend?.();
      synth.spoken[i].onerror?.({ error: 'synthesis-failed' });
    }
    expect(synth.spoken).toHaveLength(CHUNKS.length);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('tts: stop, replacement and stale events across chunks', () => {
  const LONG = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ');

  it('stopping mid-queue ends the request once and never starts the next chunk', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const request = speak(LONG, 'en', onEnd);
    synth.spoken[0].onend?.();
    synth.cancel.mockClear();
    stopSpeaking(request);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    synth.spoken[1].onend?.();
    synth.spoken[1].onerror?.({ error: 'interrupted' });
    expect(synth.spoken).toHaveLength(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('a browser that fires end on cancel does not advance a stopped queue', () => {
    const synth = installSynth((u) => u.onend?.());
    const onEnd = vi.fn();
    speak(LONG, 'en', onEnd);
    stopSpeaking();
    expect(synth.spoken).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('replacement cancels the whole old queue and plays only the new request', () => {
    const synth = installSynth();
    const endA = vi.fn();
    const endB = vi.fn();
    speak(LONG, 'en', endA);
    synth.spoken[0].onend?.();
    speak('Fresh start.', 'en', endB);
    expect(endA).toHaveBeenCalledTimes(1);
    synth.spoken[1].onend?.();
    expect(synth.spoken.map((u) => u.text)).toEqual([chunkSpeechText(LONG)[0], chunkSpeechText(LONG)[1], 'Fresh start.']);
    expect(endB).not.toHaveBeenCalled();
    synth.spoken[2].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
    expect(endA).toHaveBeenCalledTimes(1);
  });

  it('replacing a long request with another long request keeps the two queues apart', () => {
    const synth = installSynth();
    const other = Array.from({ length: 20 }, (_, i) => `Other line ${i} goes right here.`).join(' ');
    const otherChunks = chunkSpeechText(other);
    speak(LONG, 'en', vi.fn());
    const endB = vi.fn();
    speak(other, 'en', endB);
    synth.spoken[0].onend?.();
    for (let i = 1; i <= otherChunks.length; i++) synth.spoken[i].onend?.();
    expect(synth.spoken.slice(1).map((u) => u.text)).toEqual(otherChunks);
    expect(endB).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated end from an earlier chunk, so no chunk is skipped', () => {
    const synth = installSynth();
    speak(LONG, 'en', vi.fn());
    synth.spoken[0].onend?.();
    synth.spoken[0].onend?.();
    synth.spoken[0].onend?.();
    expect(synth.spoken).toHaveLength(2);
  });

  it('ignores an error from an earlier chunk that already finished', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak(LONG, 'en', onEnd, { onError });
    synth.spoken[0].onend?.();
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(synth.spoken).toHaveLength(2);
  });

  it('ignores late events from a chunk of a replaced request', () => {
    const synth = installSynth();
    const onErrorA = vi.fn();
    speak(LONG, 'en', vi.fn(), { onError: onErrorA });
    speak('Fresh start.', 'en', vi.fn());
    synth.spoken[0].onend?.();
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(onErrorA).not.toHaveBeenCalled();
    expect(synth.spoken).toHaveLength(2);
  });
});

describe('tts: errors during a later chunk', () => {
  const LONG = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ');

  it('reports a genuine error once, ends once, and stops the queue', () => {
    const synth = installSynth();
    const calls: string[] = [];
    speak(LONG, 'en', () => calls.push('end'), { onError: (r) => calls.push(`error:${r}`) });
    synth.spoken[0].onend?.();
    synth.spoken[1].onerror?.({ error: 'synthesis-failed' });
    synth.spoken[1].onerror?.({ error: 'synthesis-failed' });
    synth.spoken[1].onend?.();
    expect(calls).toEqual(['error:failed', 'end']);
    expect(synth.spoken).toHaveLength(2);
  });

  it('maps a no-voice error on a later chunk to no-voice', () => {
    const synth = installSynth();
    const onError = vi.fn();
    speak(LONG, 'en', vi.fn(), { onError });
    synth.spoken[0].onend?.();
    synth.spoken[1].onerror?.({ error: 'voice-unavailable' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('no-voice');
  });

  it.each(['interrupted', 'canceled'])('ends silently, without continuing, on a "%s" error mid-queue', (error) => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak(LONG, 'en', onEnd, { onError });
    synth.spoken[0].onend?.();
    synth.spoken[1].onerror?.({ error });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(synth.spoken).toHaveLength(2);
  });

  it('reports a failure, once, when the engine throws on a later chunk', () => {
    const synth = installSynth();
    let calls = 0;
    synth.speak.mockImplementation((u: FakeUtterance) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      synth.spoken.push(u);
    });
    const onEnd = vi.fn();
    const onError = vi.fn();
    speak(LONG, 'en', onEnd, { onError });
    synth.spoken[0].onend?.();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('failed');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('lets a new request run normally after a queue failed midway', () => {
    const synth = installSynth();
    speak(LONG, 'en', vi.fn());
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    const endB = vi.fn();
    speak('Next.', 'en', endB);
    synth.spoken[1].onend?.();
    expect(endB).toHaveBeenCalledTimes(1);
  });
});

describe('chunkSpeechText: labels stay with their items', () => {
  // A chunk ending in a bare "4." / "B." / "(a)" means that item's text starts the next chunk.
  const DETACHED = /(?:^|\s)(?:\d{1,3}|[०-९]{1,3}|[A-D])\.$|\([a-d]\)$/;
  const expectNoDetachedLabel = (chunks: string[]) => {
    for (const chunk of chunks) expect(chunk, `chunk ends on a label: ${JSON.stringify(chunk)}`).not.toMatch(DETACHED);
  };
  const expectLossless = (chunks: string[], input: string) => expect(noSpace(chunks.join(''))).toBe(noSpace(input));

  const NUMBERED = Array.from({ length: 12 }, (_, i) => `${i + 1}. Ask the class question number ${i + 1} about fractions now`).join('\n');
  const QUIZ = Array.from(
    { length: 5 },
    (_, i) =>
      `${i + 1}. What is the value of expression ${i + 1} in this long question text here?\nA. first option text\nB. second option text\nC. third option text\nD. fourth option text`
  ).join('\n');
  const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  const devanagari = (n: number) => String(n).replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]);
  const HINDI_LIST = Array.from({ length: 12 }, (_, i) => `${devanagari(i + 1)}. कक्षा में प्रश्न संख्या ${devanagari(i + 1)} पर बच्चों के साथ चर्चा करें।`).join('\n');

  for (const max of [60, 120, 200]) {
    it(`keeps every number with its item in a 12-item list (limit ${max})`, () => {
      const chunks = chunkSpeechText(NUMBERED, max);
      expectNoDetachedLabel(chunks);
      expectLossless(chunks, NUMBERED);
      for (const chunk of chunks) expect(chunk).toMatch(/^\d+\. \S/);
    });

    it(`keeps question numbers and option letters with their text in a 5-question quiz (limit ${max})`, () => {
      const chunks = chunkSpeechText(QUIZ, max);
      expectNoDetachedLabel(chunks);
      expectLossless(chunks, QUIZ);
    });

    it(`keeps Devanagari numerals with their items (limit ${max})`, () => {
      const chunks = chunkSpeechText(HINDI_LIST, max);
      expectNoDetachedLabel(chunks);
      expectLossless(chunks, HINDI_LIST);
      for (const chunk of chunks) expect(chunk).toMatch(/^[०-९]+\. \S/);
    });
  }

  it('really spans several chunks at the default limit', () => {
    expect(chunkSpeechText(NUMBERED).length).toBeGreaterThanOrEqual(3);
    expect(chunkSpeechText(QUIZ).length).toBeGreaterThanOrEqual(3);
  });

  it('starts the chunk that follows with the label, not its text', () => {
    const chunks = chunkSpeechText(NUMBERED);
    expect(chunks.slice(1).every((c) => /^\d+\. /.test(c))).toBe(true);
  });

  it('keeps one-line MCQ options together and moves the whole row to the next chunk', () => {
    expect(chunkSpeechText('Which is largest? A. 3 B. 14 C. 7 D. 9', 25)).toEqual(['Which is largest?', 'A. 3 B. 14 C. 7 D. 9']);
  });

  it('keeps each option letter with its value when the row itself has to be split', () => {
    expect(chunkSpeechText('Which is largest? A. 3 B. 14 C. 7 D. 9', 12)).toEqual(['Which is', 'largest?', 'A. 3 B. 14', 'C. 7 D. 9']);
  });

  it('keeps (a) and (b) sub-part labels with the word that follows when a sentence is split by words', () => {
    const text = 'Do (a) read the passage then (b) answer each question in your own words';
    const chunks = chunkSpeechText(text, 20);
    expect(chunks.length).toBeGreaterThan(2);
    expectNoDetachedLabel(chunks);
    expectLossless(chunks, text);
    expect(chunks.some((c) => c.includes('(a) read'))).toBe(true);
    expect(chunks.some((c) => c.includes('(b) answer'))).toBe(true);
  });

  it('keeps a label that is alone at the end of its line with the item on the next line', () => {
    expect(chunkSpeechText('4.\nNext item text')).toEqual(['4. Next item text']);
    expect(chunkSpeechText('४.\nअगला बिंदु')).toEqual(['४. अगला बिंदु']);
    expect(chunkSpeechText('Before.\nB.\nOption text here.', 20)).toEqual(['Before.', 'B. Option text here.']);
  });

  it('keeps a label with the first word of an over-long item', () => {
    const chunks = chunkSpeechText('1. alpha beta gamma delta epsilon zeta', 15);
    expect(chunks[0].startsWith('1. alpha')).toBe(true);
    expectNoDetachedLabel(chunks);
    expect(chunks.join(' ')).toBe('1. alpha beta gamma delta epsilon zeta');
  });

  it('does not lose a label that is the very last thing in the text', () => {
    expect(chunkSpeechText('5.')).toEqual(['5.']);
    expect(chunkSpeechText('Done.\n5.')).toEqual(['Done.\n5.']);
  });

  it('leaves short lists exactly as before: one chunk, same text and line breaks', () => {
    expect(chunkSpeechText('Heading.\n1. First\n2. Second')).toEqual(['Heading.\n1. First\n2. Second']);
    expect(chunkSpeechText('1. First point. 2. Second point.')).toEqual(['1. First point. 2. Second point.']);
  });

  it('still treats a number or capital at the end of a real sentence as a sentence end', () => {
    expect(chunkSpeechText('The answer is 5. Next sentence here.', 22)).toEqual(['The answer is 5.', 'Next sentence here.']);
  });

  it('does not treat a full-stop-less leading number as a label', () => {
    expect(chunkSpeechText('2024 was a year. Next one is here.', 17)).toEqual(['2024 was a year.', 'Next one is here.']);
  });
});

describe('chunkSpeechText: Q-labels and currency abbreviations', () => {
  it('keeps a Q1. label with its question when the question does not fit beside it', () => {
    const text = 'Use these MCQs to check mastery.\nQ1. What is the sum of 3 by 4 plus 1 by 2?\nA) 4 by 6';
    const chunks = chunkSpeechText(text, 40);
    for (const chunk of chunks) expect(chunk).not.toMatch(/(?:^|\s)Q\d+\.$/);
    expect(chunks.some((c) => c.startsWith('Q1. What is'))).toBe(true);
  });

  it('keeps Q2. and Q10. labels with their text, and one alone at the end of its line with the next line', () => {
    expect(chunkSpeechText('Done here.\nQ2. Which is larger of the two numbers shown?', 25)[1]).toMatch(/^Q2\. Which/);
    expect(chunkSpeechText('Done here.\nQ10. Which is larger of the two numbers shown?', 25)[1]).toMatch(/^Q10\. Which/);
    expect(chunkSpeechText('Before.\nQ3.\nNext item text', 20)).toEqual(['Before.', 'Q3. Next item text']);
  });

  it('keeps Rs. with its amount when the sentence fits', () => {
    const chunks = chunkSpeechText('A vendor sells paneer at a fixed price of Rs. 45.50 per kilogram today.', 45);
    for (const chunk of chunks) expect(chunk).not.toMatch(/\bRs\.$/);
    expect(chunks.some((c) => c.includes('Rs. 45.50'))).toBe(true);
  });

  it('keeps Rs. with its amount when a long sentence is split by words', () => {
    for (const max of [20, 24, 28, 33]) {
      const chunks = chunkSpeechText('The vendor charges for the paneer Rs. 45.50 per kilogram of paneer today', max);
      for (const chunk of chunks) expect(chunk, 'max ' + max).not.toMatch(/\bRs\.$/);
      expect(chunks.join(' ')).toBe('The vendor charges for the paneer Rs. 45.50 per kilogram of paneer today');
    }
  });

  it('keeps No. and Fig. with their number, but a real sentence end before a number still splits', () => {
    expect(chunkSpeechText('Look at Fig. 3 for the answer on the board.', 20).some((c) => c.includes('Fig. 3'))).toBe(true);
    expect(chunkSpeechText('The answer is 5. Next sentence here.', 22)).toEqual(['The answer is 5.', 'Next sentence here.']);
    expect(chunkSpeechText('He paid it all. 45 students came.', 17)).toEqual(['He paid it all.', '45 students came.']);
  });
});

describe('tts: the active utterance is referenced and then released', () => {
  const LONG = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const held = (request: SpeechRequest | null) => request?.utterance;

  it('holds the chunk that is in the engine, and moves on with the queue', () => {
    const synth = installSynth();
    const request = speak(LONG, 'en', vi.fn());
    expect(held(request)).toBe(synth.spoken[0]);
    synth.spoken[0].onend?.();
    expect(held(request)).toBe(synth.spoken[1]);
  });

  it('releases it when the last chunk finishes', () => {
    const synth = installSynth();
    const request = speak('Short.', 'en', vi.fn());
    expect(held(request)).toBe(synth.spoken[0]);
    synth.spoken[0].onend?.();
    expect(held(request)).toBeNull();
  });

  it('releases it when the request is stopped', () => {
    installSynth();
    const request = speak(LONG, 'en', vi.fn());
    stopSpeaking(request);
    expect(held(request)).toBeNull();
  });

  it('releases the old request and holds the new one when speech is replaced', () => {
    const synth = installSynth();
    const first = speak(LONG, 'en', vi.fn());
    const second = speak('Fresh start.', 'en', vi.fn());
    expect(held(first)).toBeNull();
    expect(held(second)).toBe(synth.spoken[1]);
  });

  it('releases it on a genuine error and on a silent cancellation', () => {
    const synth = installSynth();
    const failing = speak('One.', 'en', vi.fn());
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(held(failing)).toBeNull();
    const cancelled = speak('Two.', 'en', vi.fn());
    synth.spoken[1].onerror?.({ error: 'interrupted' });
    expect(held(cancelled)).toBeNull();
  });

  it('releases it when the engine throws', () => {
    const synth = installSynth();
    synth.speak.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(held(speak('One.', 'en', vi.fn(), { onError: vi.fn() }))).toBeNull();
  });

  it('does not hold anything while voices are still loading', () => {
    vi.useFakeTimers();
    installSynth(undefined, []);
    const request = speak(LONG, 'hi', vi.fn());
    expect(held(request)).toBeFalsy();
    stopSpeaking(request);
    vi.advanceTimersByTime(5000);
    expect(held(request)).toBeFalsy();
  });

  it('is not revived by a late event from a released chunk', () => {
    const synth = installSynth();
    const first = speak(LONG, 'en', vi.fn());
    const second = speak('Fresh start.', 'en', vi.fn());
    synth.spoken[0].onend?.();
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' });
    expect(held(first)).toBeNull();
    expect(held(second)).toBe(synth.spoken[1]);
    expect(synth.spoken).toHaveLength(2);
  });
});
