import { X } from 'lucide-react';
import { ONBOARDING_FEATURES } from '../config';

interface OnboardingIntroProps {
  isAdmin: boolean;
  onDismiss: () => void;
}

// First-run feature intro shown once on the empty Coach welcome screen (Phase 1
// of the onboarding rework). Presentational only: it renders the ONBOARDING_FEATURES
// list and reports a single dismiss intent — the parent owns the shown-once gate
// and persistence (preferences.onboarding.seenWelcomeIntro). Kept as its own
// component so a future "Getting Started" re-entry point (Phase 2) can reuse it
// without touching WelcomeScreen.
export default function OnboardingIntro({ isAdmin, onDismiss }: OnboardingIntroProps) {
  const features = ONBOARDING_FEATURES.filter((f) => isAdmin || !f.adminOnly);

  return (
    <section className="onboarding-intro" aria-label="Getting started">
      <div className="onboarding-intro-head">
        <div className="onboarding-intro-heading">
          <span className="onboarding-intro-eyebrow">Getting started</span>
          <h2 className="onboarding-intro-title">Here&rsquo;s what you can do</h2>
        </div>
        <button
          type="button"
          className="onboarding-dismiss onboarding-intro-close"
          onClick={onDismiss}
          aria-label="Dismiss getting started"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <ul className="onboarding-feature-grid">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <li key={feature.title} className="onboarding-feature">
              <span className="onboarding-feature-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="onboarding-feature-text">
                <span className="onboarding-feature-title">{feature.title}</span>
                <span className="onboarding-feature-desc">{feature.description}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <button type="button" className="btn-primary onboarding-intro-cta" onClick={onDismiss}>
        Got it — let&rsquo;s start
      </button>
    </section>
  );
}
