import { defineConfig } from 'vitest/config';

// Client test runner (added in AI Action Router milestone M3).
//
// Originally scoped to PURE-LOGIC modules only (src/assistant, src/lib) —
// deliberately, not an omission: introducing a component-testing culture
// mid-project was judged a separate initiative with its own conventions to
// settle (see the git history on this file / docs/ai-action-router-phase1-spec.md
// §10.3 for that original reasoning, and docs/generator-v2-plan.md for why it
// changed).
//
// REVERSED for the Structured Question Model (Generator v2, Stage 2,
// 2026-08-21) — a deliberate, discussed decision, not a quiet violation of the
// note above: testing "add/delete/reorder a question" and "save, then reload,
// and the editor still matches" as real behavior needs real component
// rendering (mirroring how the mobile app already tests its own React Native
// screens with React Native Testing Library) — a pure-logic re-implementation
// of GeneratorPage's/ResourceWorkspace's own state wiring would just be a
// second, drift-prone copy of the component, not a test of it. `src/pages` and
// `src/components` are added to `include`, and `setupFiles` registers
// `@testing-library/jest-dom`'s matchers for the new .tsx suites. Every
// existing pure-logic test file is completely unaffected — this is additive.
//
// A separate config file rather than a `test` block in vite.config.ts: vitest
// picks this up in preference, so the PWA and React plugins never load for a
// test run. Nothing here is needed to build or serve the app, and the app build
// is entirely unaffected by this file.
export default defineConfig({
  test: {
    // sessionStorage, window.crypto, JSON, and (now) DOM rendering.
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // Scoped on purpose, so "add a test" stays a deliberate act rather than a
    // wildcard that quietly starts picking up files elsewhere in the app.
    include: [
      'src/assistant/**/*.test.ts',
      'src/lib/**/*.test.ts',
      'src/pages/**/*.test.tsx',
      'src/components/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
