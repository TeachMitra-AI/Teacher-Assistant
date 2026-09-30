// Learning Representation: labeled_diagram. Deliberately not a labeled illustration: structured rendering never generates
// pixel imagery (diffusion "AI Illustration" is out of V1 scope with its own untreated trust questions). A radial layout was
// rejected because the labeled_diagram schema carries only `parts`, with no subject for the center, and adding one would
// reopen an approved backend contract. A card grid needs no subject and still reads as "the parts that make up this thing".
import type { LabeledDiagramData } from '../types';

export default function LabeledPartsView({ data }: { data: LabeledDiagramData }) {
  // A real list (<ul>/<li>) like the other list-shaped views here; <div>s give a screen reader no "N items" grouping.
  return (
    <ul className="lr-parts-grid">
      {data.parts.map((part, i) => (
        <li className="lr-part-card" key={i}>
          <span className="lr-part-index" aria-hidden="true">
            {i + 1}
          </span>
          <strong>{part.label}</strong>
          <span>{part.description}</span>
        </li>
      ))}
    </ul>
  );
}
