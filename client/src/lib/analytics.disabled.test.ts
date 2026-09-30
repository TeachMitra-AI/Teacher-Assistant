import { describe, expect, it, vi } from 'vitest';

// The "no Measurement ID configured" half of the contract; see analytics.test.ts for why it needs its own file.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  GA_MEASUREMENT_ID: '',
}));

const { initGoogleAnalytics, trackPageView } = await import('./analytics');

describe('with no Measurement ID configured', () => {
  it('initGoogleAnalytics never injects a script tag or touches window.gtag', () => {
    initGoogleAnalytics();
    expect(document.getElementById('ga4-gtag-script')).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  it('trackPageView is a no-op', () => {
    trackPageView('/library');
    expect(window.dataLayer).toBeUndefined();
  });
});
