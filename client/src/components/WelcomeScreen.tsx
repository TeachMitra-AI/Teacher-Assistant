import { ChevronRight } from 'lucide-react';
import OnboardingIntro from './OnboardingIntro';
import { QUICK_ACTIONS, ADMIN_SHORTCUTS, SUPER_ADMIN_SHORTCUT } from '../config';

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

export default function WelcomeScreen({ name, isAdmin, isSuperAdmin, showIntro, onDismissIntro, onPickAction, onNavigate }: WelcomeScreenProps) {
  const shortcuts = isSuperAdmin ? [...ADMIN_SHORTCUTS, SUPER_ADMIN_SHORTCUT] : ADMIN_SHORTCUTS;
  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <h1 className="welcome-title">Namaste{name ? `, ${name}` : ''} 👋</h1>
        <p className="welcome-subtitle">How can I help you teach today?</p>
      </div>

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
