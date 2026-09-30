import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import OnboardingIntro from './OnboardingIntro';
import DailyHighlight from './DailyHighlight';
// Support Inbox card hidden from the homepage (docs/hide-homepage-items.md): SUPER_ADMIN_SHORTCUT is dropped from this
// import because noUnusedLocals makes an unused import a build error. Restore with the line below.
// import { QUICK_ACTIONS, ADMIN_SHORTCUTS, SUPER_ADMIN_SHORTCUT } from '../config';
import { QUICK_ACTIONS, ADMIN_SHORTCUTS } from '../config';
import { getWelcomeGreeting, getDailyHighlight } from '../lib/welcome';

interface WelcomeScreenProps {
  name: string;
  isAdmin: boolean;
  // Separate from `isAdmin`: the Support Inbox shortcut is super_admin only (see AdminTabs.tsx).
  isSuperAdmin: boolean;
  // First-run intro shown once above the greeting until dismissed (the parent persists it via preferences.onboarding).
  showIntro: boolean;
  onDismissIntro: () => void;
  onPickAction: (prompt: string) => void;
  onNavigate: (to: string) => void;
}

// `isSuperAdmin` stays in WelcomeScreenProps but isn't destructured while the Support Inbox card is hidden (an unused
// binding is a build error, an unused interface field isn't), so CoachPage still passes it and restoring the card is a
// single-file change.
export default function WelcomeScreen({ name, isAdmin, showIntro, onDismissIntro, onPickAction, onNavigate }: WelcomeScreenProps) {
  // To restore the Support Inbox card, reinstate the line below and add `isSuperAdmin` back to the parameters. The Support
  // page itself is unaffected (reachable from the admin tabs).
  // const shortcuts = isSuperAdmin ? [...ADMIN_SHORTCUTS, SUPER_ADMIN_SHORTCUT] : ADMIN_SHORTCUTS;
  const shortcuts = ADMIN_SHORTCUTS;
  // Computed once per mount (and when the name changes), so the greeting/highlight stay stable for the session (lib/welcome.ts).
  const { greeting, subtitle } = useMemo(() => getWelcomeGreeting(name), [name]);
  const highlight = useMemo(() => getDailyHighlight(), []);
  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <h1 className="welcome-title">{greeting}</h1>
        <p className="welcome-subtitle">{subtitle}</p>
      </div>

      <DailyHighlight highlight={highlight} />

      {showIntro && <OnboardingIntro isAdmin={isAdmin} onDismiss={onDismissIntro} />}

      <div className="quick-action-grid">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              className={`quick-action-card${action.hideOnMobile ? ' quick-action-card--mobile-hidden' : ''}`}
              onClick={() => onPickAction(action.prompt)}
            >
              <span className="quick-action-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={2} />
              </span>
              <span className="quick-action-text">
                <span className="quick-action-title">{action.label}</span>
                <span className="quick-action-desc">{action.description}</span>
              </span>
              <ChevronRight className="quick-action-chevron" size={16} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {isAdmin && (
        <div className="admin-shortcuts">
          <span className="admin-shortcuts-label">Admin</span>
          <div className="admin-shortcut-grid">
            {shortcuts.map((shortcut) => {
              const Icon = shortcut.icon;
              return (
                <button
                  type="button"
                  key={shortcut.to}
                  className="admin-shortcut-card"
                  onClick={() => onNavigate(shortcut.to)}
                >
                  <span className="admin-shortcut-icon" aria-hidden="true">
                    <Icon size={18} strokeWidth={2} />
                  </span>
                  <span className="quick-action-text">
                    <span className="quick-action-title">{shortcut.label}</span>
                    <span className="quick-action-desc">{shortcut.description}</span>
                  </span>
                  <ChevronRight className="quick-action-chevron" size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
