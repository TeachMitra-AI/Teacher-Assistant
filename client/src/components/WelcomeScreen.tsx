import { QUICK_ACTIONS } from '../config';

interface WelcomeScreenProps {
  name: string;
  onPickAction: (prompt: string) => void;
}

export default function WelcomeScreen({ name, onPickAction }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <h1 className="welcome-title">Namaste{name ? `, ${name}` : ''} 👋</h1>
        <p className="welcome-subtitle">How can I help you teach today?</p>
      </div>

      <div className="quick-action-grid">
        {QUICK_ACTIONS.map((action) => (
          <button
            type="button"
            key={action.label}
            className="quick-action-card"
            onClick={() => onPickAction(action.prompt)}
          >
            <span className="quick-action-icon" aria-hidden="true">{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
