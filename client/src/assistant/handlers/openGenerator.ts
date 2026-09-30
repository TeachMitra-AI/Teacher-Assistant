// Handler for `open_generator`: plain navigation with no draft, for an utterance that clearly means the Generator but
// names no topic. Its effect is `read`; today it arrives as a `prefill` decision with nothing to prefill.

import { GENERATOR_ROUTE } from './routes';
import type { ActionHandler } from './types';

// Doesn't strip an existing `?ai=` handle: the Generator's applied-draft guard keys on it, so opening the page you're
// already on keeps the teacher's reviewed values.
export const openGeneratorHandler: ActionHandler = (_action, context) => {
  context.navigate(GENERATOR_ROUTE);
};
