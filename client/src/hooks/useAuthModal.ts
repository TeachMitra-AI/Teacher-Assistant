import { useEffect, useState } from 'react';
import type { Mode } from '../components/AuthForm';

// Sign In / Get Started open the auth form in a pop-up over a public page instead of navigating to /login (components/AuthModal).
// Opening pushes a history entry so Back closes the modal instead of leaving the site, as HomePage does inline.
export function useAuthModal() {
  const [authMode, setAuthMode] = useState<Mode | null>(null);

  const openAuth = (mode: Mode) => {
    if (authMode === null) {
      window.history.pushState({ authModal: true }, '');
    }
    setAuthMode(mode);
  };
  const closeAuth = () => {
    setAuthMode(null);
    if (window.history.state?.authModal) {
      window.history.back();
    }
  };

  useEffect(() => {
    const handlePopState = () => setAuthMode(null);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return { authMode, openAuth, closeAuth };
}
