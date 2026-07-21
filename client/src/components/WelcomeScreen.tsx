import { ChevronRight } from 'lucide-react';
import { QUICK_ACTIONS, ADMIN_SHORTCUTS } from '../config';

interface WelcomeScreenProps {
  name: string;
  isAdmin: boolean;
  onPickAction: (prompt: string) => void;
  onNavigate: (to: string) => void;
}

export default function WelcomeScreen({ name, isAdmin, onPickAction, onNavigate }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <h1 className="welcome-title">Namaste{name ? `, ${name}` : ''} 👋</h1>
        <p className="welcome-subtitle">How can I help you teach today?</p>
      </div>

      <div className="quick-action-grid">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              className="quick-action-card"
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
            {ADMIN_SHORTCUTS.map((shortcut) => {
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
