// Learning Representation — comparison_table (ADR Phase D2). Unchanged in
// substance from Phase D1: a table already IS the correct native
// representation for "shared dimensions across items" (ADR §4) — there is
// no more "diagram" version of a comparison to build. Extracted to its own
// file only for consistency with the other five representation views.
import type { ComparisonTableData } from '../types';

export default function ComparisonTableView({ data }: { data: ComparisonTableData }) {
  return (
    <table className="lr-table">
      <thead>
        <tr>
          <th />
          {data.items.map((item, i) => (
            <th key={i}>{item}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, i) => (
          <tr key={i}>
            <th>{row.dimension}</th>
            {row.values.map((value, j) => (
              <td key={j}>{value}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
