// Small config-parsing helper. For numeric tunables we prefer clamp-and-warn
// over crashing: a bad value for something like LLM_MAX_RETRIES should not
// take the whole server down (that is reserved for truly-required secrets,
// which keep their existing fail-fast in index.js/middleware). Local dev
// stays runnable; production stays safe because an invalid value falls back
// to a known-safe default instead of an unbounded one.

/**
 * Parse an environment variable as a bounded integer.
 * - Missing/empty → default (no warning; absence is normal).
 * - Non-integer or out-of-range → clamped to [min, max] (or default) + warn.
 *
 * @param {string|undefined} rawValue the raw env string
 * @param {object} opts
 * @param {string} opts.name env var name, for warning messages
 * @param {number} opts.defaultValue
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {(msg: string) => void} [opts.warn=console.warn]
 * @returns {number}
 */
function parseIntEnv(rawValue, { name, defaultValue, min, max, warn = console.warn }) {
  if (rawValue == null || String(rawValue).trim() === '') {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    warn(`[config] ${name}="${rawValue}" is not a valid integer; using default ${defaultValue}.`);
    return defaultValue;
  }

  if (parsed < min) {
    warn(`[config] ${name}=${parsed} is below the minimum ${min}; clamping to ${min}.`);
    return min;
  }
  if (parsed > max) {
    warn(`[config] ${name}=${parsed} is above the maximum ${max}; clamping to ${max}.`);
    return max;
  }
  return parsed;
}

module.exports = { parseIntEnv };
