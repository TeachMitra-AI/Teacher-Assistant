import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Shared onboarding UI state. The "Getting Started" entry lives in the TopBar and the intro it reopens lives in CoachPage,
// so the reopen intent needs a small app-level channel. Client-only and ephemeral: reopening never resets the persisted
// first-run gate (preferences.onboarding.seenWelcomeIntro), so the intro stays dismissed next session.
interface OnboardingContextValue {
  // True once the user asks to re-view the welcome intro, independent of the first-run gate; cleared on dismiss or a new conversation.
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
