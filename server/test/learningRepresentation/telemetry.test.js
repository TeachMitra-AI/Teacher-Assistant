// AI Learning Representation System — telemetry (ADR Phase D).

const { levelForReason, NOTABLE_REASONS, logLearningRepresentationEvent } = require('../../src/learningRepresentation/telemetry');

describe('levelForReason', () => {
  test.each(NOTABLE_REASONS)('%s is a warn-worthy failure', (reason) => {
    expect(levelForReason(reason)).toBe('warn');
  });

  test.each(['disabled', 'budget_exhausted', 'no_visualization', 'low_confidence', 'renderer_unavailable', undefined])(
    '%s is a routine, expected outcome (info)',
    (reason) => {
      expect(levelForReason(reason)).toBe('info');
    }
  );
});

describe('logLearningRepresentationEvent', () => {
  test('routes to console.log/warn/error by level and prefixes the event', () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    try {
      logLearningRepresentationEvent('info', 'x', { a: 1 });
      logLearningRepresentationEvent('warn', 'y', { b: 2 });
      logLearningRepresentationEvent('error', 'z', { c: 3 });

      expect(spies.log).toHaveBeenCalledWith('[learningRepresentation] x', { a: 1 });
      expect(spies.warn).toHaveBeenCalledWith('[learningRepresentation] y', { b: 2 });
      expect(spies.error).toHaveBeenCalledWith('[learningRepresentation] z', { c: 3 });
    } finally {
      spies.log.mockRestore();
      spies.warn.mockRestore();
      spies.error.mockRestore();
    }
  });

  test('defaults meta to an empty object', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      logLearningRepresentationEvent('info', 'no_meta');
      expect(spy).toHaveBeenCalledWith('[learningRepresentation] no_meta', {});
    } finally {
      spy.mockRestore();
    }
  });
});
