import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Shared onboarding UI state (Phase 2 of the onboarding rework). The "Getting
// Started" entry lives in the TopBar, which renders on every page, while the
// welcome intro it reopens lives in CoachPage — so the reopen intent needs a
// small app-level channel between them. This is deliberately client-only and
// ephemeral: reopening lets a user re-view the intro without ever resetting the
// persisted first-run gate (preferences.onboarding.seenWelcomeIntro), so on the
// next session the intro stays dismissed. Future phases (e.g. re-showing a
// contextual tip on demand) can extend this same provider rather than adding
// more cross-component plumbing.
interface OnboardingContextValue {
  // True once the user has explicitly asked to re-view the welcome intro,
  // independent of the first-run seenWelcomeIntro gate. Cleared when the intro
  // is dismissed or the user starts a new conversation.
  introReopened: boolean;
  reopenIntro: () => void;
  closeIntro: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [introReopened, setIntroReopened] = useState(false);
  const reopenIntro = useCallback(() => setIntroReopened(true), []);
  const closeIntro = useCallback(() => setIntroReopened(false), []);
  const value = useMemo(
    () => ({ introReopened, reopenIntro, closeIntro }),
    [introReopened, reopenIntro, closeIntro]
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
