import { api } from '../api';
import type { OnboardingState, User } from '../types';

// Shared write path for every onboarding preference change — the welcome-intro
// gate (seenWelcomeIntro) and the contextual tips (dismissedTips) alike.
// Optimistically applies the new onboarding object so the UI updates instantly,
// persists it through the same PATCH /auth/me merge Settings uses, then syncs to
// the server's response; a failed PATCH quietly rolls back (onboarding state is
// non-critical). The whole `onboarding` object is passed — not a delta — because
// the server shallow-merges `preferences` at the top level, so a partial
// onboarding would drop its sibling keys.
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
