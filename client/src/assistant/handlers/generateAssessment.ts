// Handler for `generate_assessment`: writes the resolved params to the draft store and navigates to the Generator with
// an opaque handle. Nothing is generated here; the effect is `draft`, so the teacher reviews the prefilled form and
// clicks Generate through the existing code path. Calling the generation endpoint from here would break that guarantee.

import { createDraft } from '../draftStore';
import { GENERATOR_ROUTE, PREFILL_PARAM } from './routes';
import type { ActionHandler } from './types';

// Write the draft before navigating: the Generator reads it on mount and on every `?ai=` change. If it can't be stored
// (quota, disabled storage) navigate without the handle, so the teacher gets the normal Generator instead of a dead
// URL parameter.
export const generateAssessmentHandler: ActionHandler = (action, context) => {
  const draftId = createDraft({
    actionId: action.actionId,
    version: action.version,
    initialParams: action.params,
    provenance: action.provenance,
    lowConfidenceFields: action.lowConfidenceFields,
    // Display-only, for the banner; the utterance never goes near the URL.
    utterance: context.utterance,
    // Correlation id so the Generator's telemetry joins back to the decision.
    requestId: context.requestId,
  });

  if (!draftId) {
    context.navigate(GENERATOR_ROUTE);
    return;
  }

  context.navigate(`${GENERATOR_ROUTE}?${PREFILL_PARAM}=${encodeURIComponent(draftId)}`);
};
