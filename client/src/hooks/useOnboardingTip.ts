import { useCallback } from 'react';
import { useAuth } from '../auth';
import { persistOnboarding } from '../lib/onboarding';

// One reusable primitive for every first-visit contextual tip (Phase 3). Each tip
// is identified by a stable string id and shown until the user dismisses it; the
// dismissed ids are persisted in preferences.onboarding.dismissedTips (added in
// Phase 0) so a tip never reappears, on any device. Adding a new tip is just
// picking a new id — no schema, component, or plumbing changes — which is the
// whole point of keeping dismissedTips a flat list. Dismissal persists through the
// shared persistOnboarding write path (same optimistic PATCH /auth/me flow the
// welcome intro uses), so seenWelcomeIntro and sibling tips are never clobbered.
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
