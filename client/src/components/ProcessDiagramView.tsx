// Learning Representation: process_diagram. A connected vertical flow: one continuous line behind numbered nodes, drawn with
// a single pseudo-element on the container so it stays correct however tall a step's text is.
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
