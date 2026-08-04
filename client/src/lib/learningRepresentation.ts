// Typed client for the AI Learning Representation System (ADR Phase D).
// One thin wrapper over api(), mirroring lib/adminSupport.ts's shape.
//
// Stateless by design, matching the server route: this posts the question
// and the answer already shown on screen (the server never looks anything
// up), the same "client sends what it has" contract the AI Action Router
// uses for /api/assistant/interpret.
import { api } from '../api';
import type { LearningRepresentationResponse } from '../types';

export function fetchLearningRepresentation(
  prompt: string,
  answer: string
): Promise<LearningRepresentationResponse> {
  return api<LearningRepresentationResponse>('/coach/learning-representation', {
    method: 'POST',
    body: { prompt, answer },
  });
}
