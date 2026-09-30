// Numeric config parsing. A bad value for a tunable like LLM_MAX_RETRIES clamps to a safe bound and warns
// rather than crashing; fail-fast is for required secrets only.

/**
 * Parse an environment variable as a bounded integer. Missing/empty gives the default (no warning);
 * a non-integer or out-of-range value is clamped to [min, max] (or the default) with a warning.
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
