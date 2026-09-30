import { GA_MEASUREMENT_ID } from '../config';

// Google Analytics 4 via gtag.js, loaded directly (no Tag Manager). With GA_MEASUREMENT_ID unset or malformed every
// function is a no-op: no script tag, cookies or network calls, like the other VITE_* flags.
// The stock snippet's automatic page_view is wrong for a client-rendered SPA (it fires before react-router commits the
// route, and later navigations are invisible), so initGoogleAnalytics() disables it (send_page_view: false) and App.tsx's
// useLocation() effect calls trackPageView() on every route change.
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

// Injects the gtag.js script and wires window.dataLayer/gtag once; repeat calls (e.g. Vite HMR) are a no-op via the SCRIPT_ID check.
export function initGoogleAnalytics(): void {
  if (!isValidMeasurementId(GA_MEASUREMENT_ID)) return;
  if (document.getElementById(SCRIPT_ID)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };
  window.gtag('js', new Date());
  // Consent Mode is active on this gtag.js load, so it withholds every hit until a default consent state is set. The site has
  // no cookie banner, so grant outright. Must come before 'config': consent applies to hits as they're queued.
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

// One page_view per SPA navigation (see App.tsx's AppRoutes). No-op if GA was never initialized.
export function trackPageView(path: string): void {
  if (!isValidMeasurementId(GA_MEASUREMENT_ID) || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}
