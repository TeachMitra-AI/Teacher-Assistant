import { FOLLOW_UP_ACTIONS, type FollowUpAction } from '../config';

interface FollowUpChipsProps {
  language: string;
  onAction: (action: FollowUpAction) => void;
}

export default function FollowUpChips({ language, onAction }: FollowUpChipsProps) {
  const actions = FOLLOW_UP_ACTIONS.filter((a) => {
    if (a.kind !== 'translate') return true;
    // Only offer the translate direction that isn't a no-op for the
    // language the answer is already in.
    return a.targetLanguage === 'hi' ? language !== 'hi' : language === 'hi';
  });

  return (
    <div className="follow-up-chips">
      {actions.map((action) => (
        <button
          type="button"
          key={action.id}
          className="follow-up-chip"
          onClick={() => onAction(action)}
        >
          <span aria-hidden="true">{action.icon}</span> {action.label}
        </button>
      ))}
    </div>
  );
}
