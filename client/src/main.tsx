import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initGoogleAnalytics } from './lib/analytics';
import 'katex/dist/katex.min.css';
import './index.css';

// Loads gtag.js once at startup (no-op without VITE_GA_MEASUREMENT_ID); route changes are tracked in App.tsx.
initGoogleAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
