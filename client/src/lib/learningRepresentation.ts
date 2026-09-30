// Typed client for the AI Learning Representation System: one thin wrapper over api(), like lib/adminSupport.ts. Stateless,
// matching the server route: it posts the question and the answer already on screen, the same "client sends what it has"
// contract as /api/assistant/interpret.
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
