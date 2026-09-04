import { GA_MEASUREMENT_ID } from '../config';

// Google Analytics 4 via the official Google tag (gtag.js), loaded directly —
// no Google Tag Manager. GA_MEASUREMENT_ID unset/malformed => every function
// here is a no-op, matching every other VITE_* flag's "zero new behavior when
// unset" default in config.ts: no script tag, no cookies, no network calls.
//
// This is a client-rendered SPA, so the usual gtag.js snippet (which fires an
// automatic page_view on load) is wrong here — the very first "page view"
// would fire before react-router has committed the actual route, and every
// later in-app navigation is otherwise invisible to GA (no full page load).
// initGoogleAnalytics() disables that automatic pageview (send_page_view:
// false) and App.tsx's useLocation() effect calls trackPageView() on every
// route change instead — ONE mechanism covers the first render and every
// later navigation alike.
const SCRIPT_ID = 'ga4-gtag-script';
const VALID_ID_RE = /^G-[A-Z0-9]+$/i;

declare global {
  interface Window {
    dataLayer: unknown[][];
    gtag: (...args: unknown[]) => void;
  }
}

function isValidMeasurementId(id: string): boolean {
  return VALID_ID_RE.test(id);
}

// Injects the gtag.js script tag and wires up window.dataLayer/gtag exactly
// once. Safe to call more than once (e.g. Vite HMR in dev re-running
// main.tsx) — a second call is a guarded no-op via the SCRIPT_ID check.
export function initGoogleAnalytics(): void {
  if (!isValidMeasurementId(GA_MEASUREMENT_ID)) return;
  if (document.getElementById(SCRIPT_ID)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };
  window.gtag('js', new Date());
  // Google Consent Mode is active on this gtag.js load (confirmed via Tag
  // Assistant: hits were "deferred" and reported "default consent state has
  // not been set yet"), so gtag.js withholds every hit until a default
  // consent state is declared. This site has no cookie-consent banner, so
  // there is nothing to gate on — granting outright is what tells gtag.js to
  // stop withholding hits. Must come BEFORE the 'config' call below: gtag.js
  // applies consent state to hits based on what had been set at the time
  // each hit is queued.
  window.gtag('consent', 'default', {
    ad_storage: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  });
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

// One GA4 page_view per SPA navigation — see the useLocation() effect in
// App.tsx's AppRoutes. No-op when GA was never initialized (no/invalid
// Measurement ID), so callers never need to check GA_MEASUREMENT_ID first.
export function trackPageView(path: string): void {
  if (!isValidMeasurementId(GA_MEASUREMENT_ID) || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}
