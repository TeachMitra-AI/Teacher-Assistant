// Vitest setup for component tests (Generator v2, Stage 2 —
// docs/generator-v2-plan.md). Only referenced by vitest.config.ts's
// setupFiles; pure-logic tests never load this.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL's auto-cleanup relies on a global `afterEach` (as jest provides); this
// project's test files import `afterEach` explicitly rather than using
// vitest's `globals` option, so it's registered by hand here instead —
// otherwise every .tsx suite leaks a mounted tree into the next test.
afterEach(cleanup);
