// Vitest setup for component tests (docs/generator-v2-plan.md); loaded via setupFiles, never by pure-logic tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL's auto-cleanup needs a global `afterEach`. Test files import it explicitly instead of enabling vitest `globals`,
// so it's registered here; otherwise every .tsx suite leaks a mounted tree into the next test.
afterEach(cleanup);
