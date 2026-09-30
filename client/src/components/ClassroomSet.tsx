import { useEffect, useState } from 'react';
import { GraduationCap, Square } from 'lucide-react';
import ClassroomArtifactCard from './ClassroomArtifactCard';
import { useClassroomQueue } from '../hooks/useClassroomQueue';
import { loadSavedArtifactIds, type SavedArtifactIds } from '../lib/classroom';
import type { ClassroomPlan } from '../types';

// The classroom materials attached to one Classroom Mode turn. Layout only: the queue hook decides what is generated and when,
// and each card owns its preview and Save, so MessageBubble gains one conditional line rather than a generation pipeline.

interface ClassroomSetProps {
  plan: ClassroomPlan;
  /** True when the turn was reopened from history; restored sets render idle and generate nothing until asked, so browsing old chats spends no model calls. */
  restored?: boolean;
  /** The turn's persisted id. Without it artifacts can't be stored or restored; the cards still work but don't survive a reload. */
  queryId?: string;
}

export default function ClassroomSet({ plan, restored = false, queryId }: ClassroomSetProps) {
  const queue = useClassroomQueue(plan, restored, queryId);

  // What this turn already put in the Library, fetched once for the set rather than once per card.
  const [savedIds, setSavedIds] = useState<SavedArtifactIds>({});
  const [checkingSaved, setCheckingSaved] = useState(false);

  useEffect(() => {
    if (!queryId) return;
    let active = true;
    setCheckingSaved(true);
    loadSavedArtifactIds(queryId)
      .then((ids) => { if (active) setSavedIds(ids); })
      // A failed lookup doesn't merit a toast; the only cost is a card offering Save it didn't need to.
      .catch(() => {})
      .finally(() => { if (active) setCheckingSaved(false); });
    return () => { active = false; };
  }, [queryId]);

  // The planner proposed only artifacts we can't build. Render nothing rather than an empty "Classroom materials" heading that reads as a bug.
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
        {/* Progress shows while generating too, not only at the end (the count used to be replaced by the Stop button, so
            nothing said how far along it was while waiting). The live region announces each artifact as it lands, `polite` so
            it never interrupts the coaching answer being read out. */}
        <span className="classroom-set-count" role="status" aria-live="polite">
          {readyCount} of {queue.items.length} ready
        </span>
        {queue.running && (
          <button type="button" className="classroom-set-stop" onClick={queue.stop}>
            <Square size={12} aria-hidden="true" /> Stop
          </button>
        )}
      </header>

      {/* aria-live so screen-reader users hear materials arrive; `polite` so it never interrupts the coaching answer. */}
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
