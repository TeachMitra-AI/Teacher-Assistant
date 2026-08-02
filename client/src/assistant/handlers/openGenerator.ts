// AI Action Router — handler for `open_generator` (Phase 1, Milestone M6).
//
// Plain navigation, no draft, no parameters. "Take me to the generator" — the
// natural landing place for an utterance that clearly means the Generator but
// names no topic, which is a better answer than a half-filled form or a coaching
// reply about worksheets.
//
// Its effect class is `read`, the only reversible-and-visible class in the
// design. The policy would be allowed to act on it directly once Phase 1's clamp
// is lifted; today it arrives as a `prefill` decision with nothing to prefill,
// and this handler does the only sensible thing with that.

import { GENERATOR_ROUTE } from './routes';
import type { ActionHandler } from './types';

/**
 * Navigate, and nothing else.
 *
 * Deliberately does not strip an existing `?ai=` handle when the teacher is
 * already on the Generator: the applied-draft guard on that page keys on the
 * handle, so navigating to the bare route while a prefill is on screen leaves
 * their reviewed values intact rather than silently clearing them. Asking to
 * open a page you are already on should not destroy work.
 */
export const openGeneratorHandler: ActionHandler = (_action, context) => {
  context.navigate(GENERATOR_ROUTE);
};
