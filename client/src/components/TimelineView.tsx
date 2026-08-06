// Learning Representation — timeline (ADR Phase D2). Same connected-line
// pattern as ProcessDiagramView, with a dot marker instead of a numbered
// node and a "when" pill — visually distinct from a process (sequence of
// actions) even though the underlying layout technique is shared.
import type { TimelineData } from '../types';

export default function TimelineView({ data }: { data: TimelineData }) {
  return (
    <ol className="lr-timeline">
      {data.events.map((event, i) => (
        <li className="lr-timeline-event" key={i}>
          <span className="lr-timeline-dot" aria-hidden="true" />
          <div className="lr-timeline-body">
            <span className="lr-timeline-when">{event.when}</span>
            <strong>{event.label}</strong>
            <span>{event.description}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
