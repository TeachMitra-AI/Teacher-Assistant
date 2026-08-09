import { useEffect, useState } from 'react';
import { GraduationCap, Square } from 'lucide-react';
import ClassroomArtifactCard from './ClassroomArtifactCard';
import { useClassroomQueue } from '../hooks/useClassroomQueue';
import { loadSavedArtifactIds, type SavedArtifactIds } from '../lib/classroom';
import type { ClassroomPlan } from '../types';

// The set of classroom materials attached to one Classroom Mode turn.
//
// Owns nothing but layout: the queue hook decides what is generated and when,
// each card owns its own preview and Save. This component exists so that
// MessageBubble gains ONE conditional line rather than a generation pipeline —
// the same containment the AI Action Router README asks for around the chat
// path.

interface ClassroomSetProps {
  plan: ClassroomPlan;
  /**
   * True when this turn was reopened from history rather than just answered
   * (D24). Restored sets render their cards idle and generate nothing until
   * the teacher asks — browsing old chats must not spend model calls.
   */
  restored?: boolean;
  /**
   * The turn's persisted id. Without it the generated artifacts cannot be
   * stored or restored (D25) — the cards still work, they just do not survive
   * a reload, which is the pre-D25 behaviour.
   */
  queryId?: string;
}

export default function ClassroomSet({ plan, restored = false, queryId }: ClassroomSetProps) {
  const queue = useClassroomQueue(plan, restored, queryId);

  // What this turn has ALREADY put in the Library. Fetched once for the whole
  // set rather than once per card — five cards asking the same question would
  // be five identical requests for one answer.
  const [savedIds, setSavedIds] = useState<SavedArtifactIds>({});
  const [checkingSaved, setCheckingSaved] = useState(false);

  useEffect(() => {
    if (!queryId) return;
    let active = true;
    setCheckingSaved(true);
    loadSavedArtifactIds(queryId)
      .then((ids) => { if (active) setSavedIds(ids); })
      // A failed lookup is not worth a toast: the teacher did not ask for it,
      // and the cost is only that a card offers Save when it did not need to.
      .catch(() => {})
      .finally(() => { if (active) setCheckingSaved(false); });
    return () => { active = false; };
  }, [queryId]);

  // The planner proposed only artifacts we cannot build yet. Render nothing at
  // all rather than an empty container — before P4/P5/P6 land this is a real
  // possibility (the planner offers all five; only quiz and worksheet exist),
  // and an empty "Classroom materials" heading would read as a bug.
  if (queue.items.length === 0) return null;

  const readyCount = queue.items.filter((i) => i.status === 'ready').length;

  return (
    <section className="classroom-set" aria-label="Classroom materials">
      <header className="classroom-set-head">
        <h3 className="classroom-set-title">
          <GraduationCap size={15} aria-hidden="true" />
          Classroom materials
          <span className="classroom-set-topic">{plan.topic}</span>
        </h3>
        {/* Progress is shown WHILE generating too, not only at the end (P7
            accessibility pass). Previously the count was replaced by the Stop
            button, so the one moment a teacher most wants to know how far
            along it is — while waiting — was the moment nothing said. The
            live region announces each artifact as it lands; `polite` so it
            never interrupts the coaching answer being read out. */}
        <span className="classroom-set-count" role="status" aria-live="polite">
          {readyCount} of {queue.items.length} ready
        </span>
        {queue.running && (
          <button type="button" className="classroom-set-stop" onClick={queue.stop}>
            <Square size={12} aria-hidden="true" /> Stop
          </button>
        )}
      </header>

      {/* aria-live so a teacher using a screen reader hears materials arrive
          rather than having to go looking for them. `polite` — this must never
          interrupt the coaching answer being read out. */}
      <div className="classroom-set-list" aria-live="polite">
        {queue.items.map((item) => (
          <ClassroomArtifactCard
            key={item.artifact}
            item={item}
            plan={plan}
            onRetry={() => queue.retry(item.artifact)}
            queryId={queryId}
            savedResourceId={savedIds[item.artifact]}
            checkingSaved={checkingSaved}
          />
        ))}
      </div>

      <p className="classroom-set-note">Nothing is saved until you press Save on a card.</p>
    </section>
  );
}
