// Learning Representation: comparison_table. A table is already the right native representation for "shared dimensions
// across items", so there's no diagram version to build; it's its own file for consistency with the other views.
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
