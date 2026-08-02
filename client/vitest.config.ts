import { defineConfig } from 'vitest/config';

// Client test runner (added in AI Action Router milestone M3).
//
// Deliberately narrow. This runs PURE-LOGIC modules only — no React Testing
// Library, no component rendering. That is a decision, not an omission: the
// draft store has TTL, eviction, quota and corrupt-JSON paths that are cheap to
// test and guaranteed to occur on the target devices, whereas introducing a
// component-testing culture mid-project is a separate initiative with its own
// conventions to settle. Component behaviour is covered by the manual script.
// See docs/ai-action-router-phase1-spec.md §10.3.
//
// A separate config file rather than a `test` block in vite.config.ts: vitest
// picks this up in preference, so the PWA and React plugins never load for a
// test run. Nothing here is needed to build or serve the app, and the app build
// is entirely unaffected by this file.
export default defineConfig({
  test: {
    // sessionStorage, window.crypto and JSON are all the modules under test need.
    environment: 'jsdom',
    // Scoped to the assistant folder — plus, as of the multimodal-attachments
    // feature, src/lib — on purpose: it keeps the runner's remit explicit, so
    // "add a test" stays a deliberate act rather than a wildcard that quietly
    // starts picking up files elsewhere in the app. src/lib is added for
    // exactly the same reason src/assistant was: PURE-LOGIC modules with real
    // edge cases (attachmentValidation.ts's size/type checks) that are cheap
    // to test in isolation. This does NOT reopen the "no component rendering"
    // decision above — no React Testing Library, no .tsx under test here.
    include: ['src/assistant/**/*.test.ts', 'src/lib/**/*.test.ts'],
    restoreMocks: true,
  },
});
