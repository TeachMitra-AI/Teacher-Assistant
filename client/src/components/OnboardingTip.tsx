import { Lightbulb, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface OnboardingTipProps {
  // Leading icon; defaults to a lightbulb to read as a helpful hint.
  icon?: LucideIcon;
  onDismiss: () => void;
  children: ReactNode;
}

// Inline first-visit contextual tip. Deliberately not an overlay or spotlight: it sits in normal flow at the top of the
// feature it explains, so it never covers UI or blocks an action and scrolls with the page on mobile. The parent decides
// whether to render it (useOnboardingTip) and owns dismiss persistence; this only draws the callout and one dismiss control.
export default function OnboardingTip({ icon: Icon = Lightbulb, onDismiss, children }: OnboardingTipProps) {
  return (
    <div className="onboarding-tip" role="note">
      <span className="onboarding-tip-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className="onboarding-tip-body">{children}</div>
      <button
        type="button"
        className="onboarding-dismiss onboarding-tip-close"
        onClick={onDismiss}
        aria-label="Dismiss tip"
      >
        <X size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
