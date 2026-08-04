// Request-level render cache — AI Learning Representation System, Phase E.
//
// Three things matter here, mirroring the frozen architecture discussion:
//   1. THE KEY is exactly {representation, prompt, answer, version} — no
//      more, no less — and changing any one of the four changes the key.
//   2. A HIT NEVER CALLS render() (the whole point — proven by injecting a
//      render() that throws if invoked and confirming the cached path
//      never reaches it).
//   3. A FAILURE IS NEVER CACHED — every render() failure reason is
//      exercised to prove none of them get written.
//
// `render()` itself is never imported directly here except to confirm
// renderWithCache delegates to the real module — everything else uses an
// injected fake gemini, the same pattern classifier.test.js and
// renderer.test.js already established.

const {
  MAX_CACHE_ENTRIES,
  EVICTION_BATCH,
  buildCacheKey,
  createRenderCache,
  renderWithCache,
} = require('../../../src/learningRepresentation/rendering/cache');
const { RENDER_SPECS } = require('../../../src/learningRepresentation/rendering/schemas');

function fakeGemini(behaviour) {
  const calls = [];
  return {
    calls,
    async generateContent(params, options) {
      calls.push({ params, options });
      if (behaviour.throws) throw behaviour.throws;
      return { text: behaviour.text, metrics: behaviour.metrics || { callsMade: 1 } };
    },
  };
}

const PROCESS_DATA = {
  steps: [
    { label: 'a', description: 'b' },
    { label: 'c', description: 'd' },
  ],
};
const okGemini = () => fakeGemini({ text: JSON.stringify(PROCESS_DATA) });

const BASE_ARGS = { representation: 'process_diagram', prompt: 'Explain X', answer: 'X happens because Y.', version: 1 };

describe('buildCacheKey', () => {
  test('is deterministic — identical inputs produce identical keys', () => {
    expect(buildCacheKey(BASE_ARGS)).toBe(buildCacheKey({ ...BASE_ARGS }));
  });

  test('is a 64-character hex digest (sha256)', () => {
    expect(buildCacheKey(BASE_ARGS)).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each(['representation', 'prompt', 'answer', 'version'])('changing %s changes the key', (field) => {
    const changed = { ...BASE_ARGS, [field]: field === 'version' ? BASE_ARGS.version + 1 : `${BASE_ARGS[field]}!` };
    expect(buildCacheKey(changed)).not.toBe(buildCacheKey(BASE_ARGS));
  });

  test('does not collide across a field boundary shift (NUL-delimited, not naively concatenated)', () => {
    // "a b" / "c" and "a" / "b c" would collide under plain concatenation
    // with no delimiter; NUL-delimiting keeps them distinct.
    const k1 = buildCacheKey({ representation: 'r', version: 1, prompt: 'a b', answer: 'c' });
    const k2 = buildCacheKey({ representation: 'r', version: 1, prompt: 'a', answer: 'b c' });
    expect(k1).not.toBe(k2);
  });
});

describe('createRenderCache — get/set', () => {
  test('a miss returns undefined', () => {
    const cache = createRenderCache();
    expect(cache.get('missing-key')).toBeUndefined();
  });

  test('set then get returns the stored value', () => {
    const cache = createRenderCache();
    const value = { representation: 'process_diagram', data: PROCESS_DATA };
    cache.set('k1', value);
    expect(cache.get('k1')).toEqual(value);
  });

  test('size reflects distinct keys stored', () => {
    const cache = createRenderCache();
    cache.set('k1', { representation: 'a', data: {} });
    cache.set('k2', { representation: 'b', data: {} });
    expect(cache.size()).toBe(2);
  });

  test('setting the same key twice does not grow size', () => {
    const cache = createRenderCache();
    cache.set('k1', { representation: 'a', data: { v: 1 } });
    cache.set('k1', { representation: 'a', data: { v: 2 } });
    expect(cache.size()).toBe(1);
    expect(cache.get('k1')).toEqual({ representation: 'a', data: { v: 2 } });
  });
});

describe('createRenderCache — bounded, LRU-ish eviction (mirrors assistant/budget.js)', () => {
  test('eviction keeps the map under the cap', () => {
    const cache = createRenderCache();
    for (let i = 0; i < MAX_CACHE_ENTRIES + 50; i += 1) {
      cache.set(`k${i}`, { representation: 'x', data: { i } });
    }
    expect(cache.size()).toBeLessThan(MAX_CACHE_ENTRIES);
    expect(cache.size()).toBeGreaterThan(MAX_CACHE_ENTRIES - EVICTION_BATCH - 100);
  });

  test('the most recently set entry survives eviction', () => {
    const cache = createRenderCache();
    for (let i = 0; i < MAX_CACHE_ENTRIES + 50; i += 1) {
      cache.set(`k${i}`, { representation: 'x', data: { i } });
    }
    expect(cache.get(`k${MAX_CACHE_ENTRIES + 49}`)).toEqual({ representation: 'x', data: { i: MAX_CACHE_ENTRIES + 49 } });
  });

  test('a get() touch protects an entry from being among the next evicted', () => {
    const cache = createRenderCache();
    for (let i = 0; i < MAX_CACHE_ENTRIES; i += 1) cache.set(`k${i}`, { representation: 'x', data: { i } });

    // Touch the very first entry — without the touch it would be first evicted.
    cache.get('k0');

    // Push past the cap so eviction fires.
    for (let i = MAX_CACHE_ENTRIES; i < MAX_CACHE_ENTRIES + EVICTION_BATCH; i += 1) {
      cache.set(`k${i}`, { representation: 'x', data: { i } });
    }

    expect(cache.get('k0')).toEqual({ representation: 'x', data: { i: 0 } });
  });
});

describe('renderWithCache — a miss calls render() and populates the cache', () => {
  test('first call misses, calls gemini once, and returns the rendered data', async () => {
    const gemini = okGemini();
    const cache = createRenderCache();

    const result = await renderWithCache({ gemini, ...BASE_ARGS, requestId: 'r1', cache });

    expect(result).toEqual({ ok: true, representation: 'process_diagram', data: PROCESS_DATA, cached: false });
    expect(gemini.calls).toHaveLength(1);
  });

  test('a successful render is stored under the expected key', async () => {
    const gemini = okGemini();
    const cache = createRenderCache();
    await renderWithCache({ gemini, ...BASE_ARGS, requestId: 'r1', cache });

    const key = buildCacheKey({ ...BASE_ARGS, version: RENDER_SPECS.process_diagram.version });
    expect(cache.get(key)).toEqual({ representation: 'process_diagram', data: PROCESS_DATA });
  });
});

describe('renderWithCache — a hit NEVER calls render()/gemini', () => {
  test('second identical call is a cache hit, gemini called zero times', async () => {
    const cache = createRenderCache();
    const gemini1 = okGemini();
    await renderWithCache({ gemini: gemini1, ...BASE_ARGS, requestId: 'r1', cache });
    expect(gemini1.calls).toHaveLength(1);

    // A gemini instance that THROWS if ever invoked — proves the second call
    // never reaches it.
    const gemini2 = fakeGemini({ throws: new Error('renderWithCache must not call gemini on a cache hit') });
    const result = await renderWithCache({ gemini: gemini2, ...BASE_ARGS, requestId: 'r2', cache });

    expect(gemini2.calls).toHaveLength(0);
    expect(result).toEqual({ ok: true, representation: 'process_diagram', data: PROCESS_DATA, cached: true });
  });

  test('a different prompt is a cache MISS, not a false hit', async () => {
    const cache = createRenderCache();
    await renderWithCache({ gemini: okGemini(), ...BASE_ARGS, requestId: 'r1', cache });

    const gemini2 = okGemini();
    const result = await renderWithCache({
      gemini: gemini2,
      ...BASE_ARGS,
      prompt: 'Explain something else entirely',
      requestId: 'r2',
      cache,
    });

    expect(gemini2.calls).toHaveLength(1);
    expect(result.cached).toBe(false);
  });

  test('a different answer is a cache MISS — grounding means different answers are different renders', async () => {
    const cache = createRenderCache();
    await renderWithCache({ gemini: okGemini(), ...BASE_ARGS, requestId: 'r1', cache });

    const gemini2 = okGemini();
    const result = await renderWithCache({
      gemini: gemini2,
      ...BASE_ARGS,
      answer: 'A completely different answer text.',
      requestId: 'r2',
      cache,
    });

    expect(gemini2.calls).toHaveLength(1);
    expect(result.cached).toBe(false);
  });
});

describe('renderWithCache — failures are never cached', () => {
  const failureCases = [
    ['a timeout', Object.assign(new Error('t'), { name: 'TimeoutError' })],
    ['a safety block', Object.assign(new Error('b'), { code: 'INPUT_BLOCKED' })],
    ['an upstream error', new Error('fetch failed')],
  ];

  test.each(failureCases)('%s is not written to the cache', async (_name, error) => {
    const cache = createRenderCache();
    const failingGemini = fakeGemini({ throws: error });
    const failed = await renderWithCache({ gemini: failingGemini, ...BASE_ARGS, requestId: 'r1', cache });
    expect(failed.ok).toBe(false);
    expect(cache.size()).toBe(0);

    // A subsequent call with a working gemini must still hit the network —
    // proving nothing was cached from the failure.
    const workingGemini = okGemini();
    const retried = await renderWithCache({ gemini: workingGemini, ...BASE_ARGS, requestId: 'r2', cache });
    expect(retried).toMatchObject({ ok: true, cached: false });
    expect(workingGemini.calls).toHaveLength(1);
  });

  test('invalid structured content (fails resultSchema) is not cached', async () => {
    const cache = createRenderCache();
    const badGemini = okGemini();
    badGemini.generateContent = async () => ({ text: JSON.stringify({ steps: [{ label: 'only one, too short' }] }) });
    const failed = await renderWithCache({ gemini: badGemini, ...BASE_ARGS, requestId: 'r1', cache });
    expect(failed).toMatchObject({ ok: false, reason: 'invalid_content' });
    expect(cache.size()).toBe(0);
  });
});

describe('renderWithCache — degenerate input never throws, never touches the cache', () => {
  test('an unsupported representation bypasses the cache and delegates to render() directly', async () => {
    const cache = createRenderCache();
    const gemini = okGemini();
    const result = await renderWithCache({
      gemini,
      representation: 'verbal_explanation',
      prompt: 'x',
      answer: 'y',
      version: 1,
      requestId: 'r1',
      cache,
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid_representation' });
    expect(gemini.calls).toHaveLength(0);
    expect(cache.size()).toBe(0);
  });

  test('a missing cache degrades to always-miss, never throws', async () => {
    const gemini = okGemini();
    const result = await renderWithCache({ gemini, ...BASE_ARGS, requestId: 'r1', cache: undefined });
    expect(result).toEqual({ ok: true, representation: 'process_diagram', data: PROCESS_DATA, cached: false });
    expect(gemini.calls).toHaveLength(1);
  });
});
