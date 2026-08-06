// Learning Representation — process_diagram (ADR Phase D2). A connected
// vertical flow: one continuous line behind numbered nodes, drawn with a
// single pseudo-element on the container rather than per-step math, so it
// stays correct regardless of how tall any individual step's text runs.
import type { ProcessDiagramData } from '../types';

export default function ProcessDiagramView({ data }: { data: ProcessDiagramData }) {
  return (
    <ol className="lr-flow">
      {data.steps.map((step, i) => (
        <li className="lr-flow-step" key={i}>
          <span className="lr-flow-node" aria-hidden="true">
            {i + 1}
          </span>
          <div className="lr-flow-body">
            <strong>{step.label}</strong>
            <span>{step.description}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
