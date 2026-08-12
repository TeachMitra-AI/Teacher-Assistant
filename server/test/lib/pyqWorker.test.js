const {
  buildInitialExtractionState,
  parseExtractionState,
  nextPendingPage,
  computePaperStatus,
} = require('../../src/lib/pyqWorker');

describe('pyqWorker.buildInitialExtractionState', () => {
  test('builds a fully-pending map for a known page count', () => {
    expect(buildInitialExtractionState(3)).toEqual({ '1': 'pending', '2': 'pending', '3': 'pending' });
  });

  test('returns an empty map for a zero page count', () => {
    expect(buildInitialExtractionState(0)).toEqual({});
  });
});

describe('pyqWorker.parseExtractionState', () => {
  test('parses valid JSON', () => {
    expect(parseExtractionState('{"1":"done","2":"pending"}')).toEqual({ '1': 'done', '2': 'pending' });
  });

  test('tolerates null/undefined/malformed JSON/non-object JSON as "nothing recorded yet"', () => {
    expect(parseExtractionState(null)).toEqual({});
    expect(parseExtractionState(undefined)).toEqual({});
    expect(parseExtractionState('not json')).toEqual({});
    expect(parseExtractionState('[1,2,3]')).toEqual({});
    expect(parseExtractionState('"a string"')).toEqual({});
  });
});

describe('pyqWorker.nextPendingPage', () => {
  test('returns the lowest-numbered pending page', () => {
    expect(nextPendingPage({ '1': 'done', '2': 'pending', '3': 'pending' })).toBe(2);
  });

  test('returns null when nothing is pending, including an empty map', () => {
    expect(nextPendingPage({ '1': 'done', '2': 'failed' })).toBeNull();
    expect(nextPendingPage({})).toBeNull();
  });
});

describe('pyqWorker.computePaperStatus', () => {
  test('is "extracting" for an empty map or while any page is pending', () => {
    expect(computePaperStatus({})).toBe('extracting');
    expect(computePaperStatus({ '1': 'done', '2': 'pending' })).toBe('extracting');
  });

  test('is "extraction_failed" only when EVERY known page failed', () => {
    expect(computePaperStatus({ '1': 'failed', '2': 'failed' })).toBe('extraction_failed');
  });

  test('is "needs_review" once nothing is pending and at least one page succeeded', () => {
    expect(computePaperStatus({ '1': 'done', '2': 'failed' })).toBe('needs_review');
    expect(computePaperStatus({ '1': 'done' })).toBe('needs_review');
  });
});
