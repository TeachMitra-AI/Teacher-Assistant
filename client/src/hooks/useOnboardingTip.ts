import { useCallback } from 'react';
import { useAuth } from '../auth';
import { persistOnboarding } from '../lib/onboarding';

// Primitive for every first-visit contextual tip. A tip has a stable string id and shows until dismissed; dismissed ids persist
// in preferences.onboarding.dismissedTips so it never reappears on any device, and a new tip is just a new id. Dismissal goes
// through persistOnboarding (the same optimistic PATCH /auth/me flow as the welcome intro), so seenWelcomeIntro and sibling
// tips aren't clobbered.
export function useOnboardingTip(id: string) {
  const { user, updateUser } = useAuth();

  const dismissed = user?.preferences.onboarding?.dismissedTips ?? [];
  const visible = !!user && !dismissed.includes(id);

  const dismiss = useCallback(async () => {
    if (!user) return;
    const current = user.preferences.onboarding?.dismissedTips ?? [];
    if (current.includes(id)) return;
    await persistOnboarding(user, updateUser, { ...user.preferences.onboarding, dismissedTips: [...current, id] });
  }, [user, updateUser, id]);

  return { visible, dismiss };
}
