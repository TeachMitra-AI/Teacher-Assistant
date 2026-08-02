// AI Action Router — handler for `generate_assessment` (Phase 1, Milestone M6).
//
// The one action that carries values. It writes the resolved parameters into the
// draft store and navigates to the Generator with an opaque handle; from there
// the M3 integration takes over and this module is done.
//
// NOTHING IS GENERATED HERE. The effect class is `draft`, which means "prepare
// something a human then commits". The teacher reviews a prefilled form and
// clicks Generate — the existing, untouched code path. A handler that called the
// generation endpoint would be the single change that invalidates the whole
// safety argument (G25, technical-debt item #8).

import { createDraft } from '../draftStore';
import { GENERATOR_ROUTE, PREFILL_PARAM } from './routes';
import type { ActionHandler } from './types';

/**
 * Write the draft, then navigate.
 *
 * That order matters: the Generator reads the draft on mount and on every `?ai=`
 * change, so a handle that arrives before its draft would read as "no usable
 * draft" and open an empty form.
 *
 * ─── WHEN THE DRAFT CANNOT BE STORED ──────────────────────────────────────
 * `createDraft` returns null on quota exhaustion or disabled storage, both of
 * which are routine on the target devices. Navigating with a handle that resolves
 * to nothing would land the teacher on an empty form with a dead parameter in
 * their URL, so we navigate WITHOUT the handle instead: they get the Generator
 * with its normal defaults, which is exactly today's behaviour and precisely
 * what the draft store's fail-soft contract promises.
 */
export const generateAssessmentHandler: ActionHandler = (action, context) => {
  const draftId = createDraft({
    actionId: action.actionId,
    version: action.version,
    initialParams: action.params,
    provenance: action.provenance,
    lowConfidenceFields: action.lowConfidenceFields,
    // Display-only, for the banner. encodeURIComponent below covers the handle,
    // never this — the utterance does not go near the URL.
    utterance: context.utterance,
    // Opaque correlation id, carried so the Generator's telemetry can be joined
    // to the decision that produced this draft (M8).
    requestId: context.requestId,
  });

  if (!draftId) {
    context.navigate(GENERATOR_ROUTE);
    return;
  }

  context.navigate(`${GENERATOR_ROUTE}?${PREFILL_PARAM}=${encodeURIComponent(draftId)}`);
};
