import { GraduationCap, Square } from 'lucide-react';
import ClassroomArtifactCard from './ClassroomArtifactCard';
import { useClassroomQueue } from '../hooks/useClassroomQueue';
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
}

export default function ClassroomSet({ plan }: ClassroomSetProps) {
  const queue = useClassroomQueue(plan);

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
        {queue.running ? (
          <button type="button" className="classroom-set-stop" onClick={queue.stop}>
            <Square size={12} aria-hidden="true" /> Stop
          </button>
        ) : (
          <span className="classroom-set-count">
            {readyCount} of {queue.items.length} ready
          </span>
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
          />
        ))}
      </div>

      <p className="classroom-set-note">Nothing is saved until you press Save on a card.</p>
    </section>
  );
}
