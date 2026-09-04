import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initGoogleAnalytics } from './lib/analytics';
import 'katex/dist/katex.min.css';
import './index.css';

// Loads gtag.js once at startup (no-op without VITE_GA_MEASUREMENT_ID). Route
// changes are tracked separately — see App.tsx's useLocation() effect.
initGoogleAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
