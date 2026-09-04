import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GA_MEASUREMENT_ID is a BUILD-TIME constant read at module load — one
// module registry state per file (same reasoning as
// assistant/telemetryTransport.flagsOff.test.ts), so the "configured" and
// "unconfigured" states live in separate files rather than being switched
// mid-file.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  GA_MEASUREMENT_ID: 'G-TESTID123',
}));

const { initGoogleAnalytics, trackPageView } = await import('./analytics');

function resetGaState() {
  document.getElementById('ga4-gtag-script')?.remove();
  // @ts-expect-error test-only teardown of globals initGoogleAnalytics sets
  delete window.gtag;
  // @ts-expect-error test-only teardown of globals initGoogleAnalytics sets
  delete window.dataLayer;
}

beforeEach(resetGaState);
afterEach(resetGaState);

describe('initGoogleAnalytics', () => {
  it('injects the gtag.js script tag for the configured Measurement ID', () => {
    initGoogleAnalytics();
    const script = document.getElementById('ga4-gtag-script') as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TESTID123');
    expect(script?.async).toBe(true);
  });

  it('configures gtag with the automatic pageview disabled', () => {
    initGoogleAnalytics();
    expect(
      window.dataLayer.some((entry) => entry[0] === 'config' && (entry[2] as { send_page_view?: boolean })?.send_page_view === false)
    ).toBe(true);
  });

  it('grants a default consent state BEFORE the config call, so gtag.js never withholds hits', () => {
    initGoogleAnalytics();
    const consentIndex = window.dataLayer.findIndex((entry) => entry[0] === 'consent');
    const configIndex = window.dataLayer.findIndex((entry) => entry[0] === 'config');

    expect(consentIndex).toBeGreaterThanOrEqual(0);
    expect(configIndex).toBeGreaterThan(consentIndex);

    const [, mode, params] = window.dataLayer[consentIndex] as [string, string, Record<string, string>];
    expect(mode).toBe('default');
    expect(params).toEqual({
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('never injects a second script tag on repeated calls', () => {
    initGoogleAnalytics();
    initGoogleAnalytics();
    initGoogleAnalytics();
    expect(document.querySelectorAll('#ga4-gtag-script')).toHaveLength(1);
  });
});

describe('trackPageView', () => {
  it('pushes a page_view event with the given path once GA is initialized', () => {
    initGoogleAnalytics();
    window.dataLayer.length = 0; // clear init's own pushes so this assertion is precise

    trackPageView('/library');

    expect(window.dataLayer).toHaveLength(1);
    const [type, name, params] = window.dataLayer[0] as [string, string, { page_path?: string }];
    expect(type).toBe('event');
    expect(name).toBe('page_view');
    expect(params.page_path).toBe('/library');
  });

  it('does nothing before GA has been initialized', () => {
    trackPageView('/library');
    expect(window.dataLayer).toBeUndefined();
  });
});
