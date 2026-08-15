import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import OnboardingIntro from './OnboardingIntro';
import DailyHighlight from './DailyHighlight';
// HIDDEN FROM THE HOMEPAGE (2026-08-15) — see docs/hide-homepage-items.md.
// SUPER_ADMIN_SHORTCUT is dropped from this import while the Support Inbox
// card is hidden; tsconfig's noUnusedLocals makes an unused import a build
// error, so it cannot simply be left here. Restore with the line below.
// import { QUICK_ACTIONS, ADMIN_SHORTCUTS, SUPER_ADMIN_SHORTCUT } from '../config';
import { QUICK_ACTIONS, ADMIN_SHORTCUTS } from '../config';
import { getWelcomeGreeting, getDailyHighlight } from '../lib/welcome';

interface WelcomeScreenProps {
  name: string;
  isAdmin: boolean;
  // Separate from `isAdmin` — the Support Inbox shortcut is super_admin
  // only, unlike Dashboard/Manage which every admin role sees (see
  // AdminTabs.tsx for the same access-control reasoning).
  isSuperAdmin: boolean;
  // First-run onboarding intro: shown once above the greeting until the teacher
  // dismisses it (the parent persists that via preferences.onboarding).
  showIntro: boolean;
  onDismissIntro: () => void;
  onPickAction: (prompt: string) => void;
  onNavigate: (to: string) => void;
}

// `isSuperAdmin` stays declared in WelcomeScreenProps above but is
// deliberately NOT destructured here while the Support Inbox card is hidden:
// an unused interface field is legal, an unused binding is a build error
// (tsconfig noUnusedLocals). Keeping the prop in the interface means
// CoachPage.tsx still passes it and needs no edit, so restoring the card is a
// single-file change. See docs/hide-homepage-items.md.
export default function WelcomeScreen({ name, isAdmin, showIntro, onDismissIntro, onPickAction, onNavigate }: WelcomeScreenProps) {
  // HIDDEN FROM THE HOMEPAGE (2026-08-15) — restore the Support Inbox card by
  // reinstating the commented line and adding `isSuperAdmin` back to the
  // parameters above. The Support PAGE is untouched and still reachable from
  // the admin tabs (components/AdminTabs.tsx).
  // const shortcuts = isSuperAdmin ? [...ADMIN_SHORTCUTS, SUPER_ADMIN_SHORTCUT] : ADMIN_SHORTCUTS;
  const shortcuts = ADMIN_SHORTCUTS;
  // Computed once per mount (and whenever the name changes) rather than on
  // every re-render, so the greeting/highlight stay stable for the whole
  // session — see lib/welcome.ts for why the underlying selection is already
  // deterministic by date.
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
