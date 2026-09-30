import { api } from '../api';
import type { OnboardingState, User } from '../types';

// Shared write path for onboarding preference changes (the seenWelcomeIntro gate and dismissedTips). Applies the new object
// optimistically, persists it through the same PATCH /auth/me merge Settings uses, then syncs to the response; a failed PATCH
// quietly rolls back since onboarding state is non-critical. The whole `onboarding` object is sent, not a delta, because
// the server shallow-merges `preferences` and a partial object would drop sibling keys.
export async function persistOnboarding(
  user: User,
  updateUser: (next: User) => void,
  nextOnboarding: OnboardingState,
): Promise<void> {
  const previousUser = user;
  updateUser({ ...user, preferences: { ...user.preferences, onboarding: nextOnboarding } });
  try {
    const res = await api<{ user: User }>('/auth/me', {
      method: 'PATCH',
      body: { preferences: { onboarding: nextOnboarding } },
    });
    updateUser(res.user);
  } catch {
    updateUser(previousUser);
  }
}
