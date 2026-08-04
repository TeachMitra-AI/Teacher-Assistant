// Learning Representation — labeled_diagram (ADR Phase D2).
//
// Deliberately NOT a labeled illustration with a real picture — structured
// rendering (ADR §6) never generates pixel imagery, and doing so here would
// mean quietly reaching for diffusion-generated "AI Illustration", which is
// explicitly out of V1 scope (ADR §8) with its own, not-yet-designed trust
// treatment. A radial/spoke layout (parts arranged around a center subject)
// was considered and rejected for this pass: the data this component
// receives has no "subject" field to put at the center — RENDER_SPECS'
// labeled_diagram schema (Phase C, already approved) only carries `parts`
// — and adding one would mean reopening an approved backend contract for a
// D2 (frontend-only) pass. A card grid needs no subject and still reads
// clearly as "the parts that make up this thing" without implying a
// picture exists.
import type { LabeledDiagramData } from '../types';

export default function LabeledPartsView({ data }: { data: LabeledDiagramData }) {
  // A real list (<ul>/<li>), not <div>s — every other list-shaped view in
  // this feature uses one, and this was a plain inconsistency rather than a
  // deliberate choice: <div>s give a screen reader no "N items" grouping at
  // all. Surfaced during Phase D2 review.
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
