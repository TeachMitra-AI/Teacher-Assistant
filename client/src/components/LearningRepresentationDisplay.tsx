// AI Learning Representation System (ADR Phase D) — the "smaller first
// slice" chosen for Phase D: a single generic display using plain semantic
// HTML (lists, a table) for every representation type, not yet a polished
// per-type visual (diagram/chart library). That polish is explicitly
// deferred to a follow-up slice — see the ADR and the Phase D approval
// discussion. `recharts` is already a dependency (used elsewhere in the
// app) and is the natural choice for graph_chart when that pass happens;
// deliberately not reached for here so every representation type gets the
// same plain treatment in this first slice, rather than one type looking
// more "finished" than the rest.
import type {
  ComparisonTableData,
  GraphChartData,
  HierarchyDiagramData,
  LabeledDiagramData,
  LearningRepresentationData,
  LearningRepresentationType,
  ProcessDiagramData,
  TimelineData,
} from '../types';

interface HierarchyNode {
  id: string;
  label: string;
  parentId: string | null;
}
interface TreeNode extends HierarchyNode {
  children: TreeNode[];
}

// The server already validated (schemas.js's hierarchy_diagram refine) that
// there is exactly one root and every parentId resolves — this rebuilds the
// tree for display, trusting that invariant rather than re-checking it.
function buildTree(nodes: HierarchyNode[]): TreeNode | null {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  let root: TreeNode | null = null;
  for (const node of byId.values()) {
    if (node.parentId === null) {
      root = node;
    } else {
      byId.get(node.parentId)?.children.push(node);
    }
  }
  return root;
}

function HierarchyBranch({ node }: { node: TreeNode }) {
  return (
    <li>
      {node.label}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <HierarchyBranch key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface DisplayProps {
  representation: LearningRepresentationType;
  data: LearningRepresentationData;
}

export default function LearningRepresentationDisplay({ representation, data }: DisplayProps) {
  switch (representation) {
    case 'process_diagram': {
      const { steps } = data as ProcessDiagramData;
      return (
        <ol className="lr-steps">
          {steps.map((step, i) => (
            <li key={i}>
              <strong>{step.label}</strong>
              <span>{step.description}</span>
            </li>
          ))}
        </ol>
      );
    }

    case 'comparison_table': {
      const { items, rows } = data as ComparisonTableData;
      return (
        <table className="lr-table">
          <thead>
            <tr>
              <th />
              {items.map((item, i) => (
                <th key={i}>{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
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

    case 'timeline': {
      const { events } = data as TimelineData;
      return (
        <ol className="lr-timeline">
          {events.map((event, i) => (
            <li key={i}>
              <span className="lr-timeline-when">{event.when}</span>
              <strong>{event.label}</strong>
              <span>{event.description}</span>
            </li>
          ))}
        </ol>
      );
    }

    case 'hierarchy_diagram': {
      const { nodes } = data as HierarchyDiagramData;
      const root = buildTree(nodes);
      if (!root) return null;
      return (
        <ul className="lr-hierarchy">
          <HierarchyBranch node={root} />
        </ul>
      );
    }

    case 'labeled_diagram': {
      const { parts } = data as LabeledDiagramData;
      return (
        <ul className="lr-parts">
          {parts.map((part, i) => (
            <li key={i}>
              <strong>{part.label}</strong>
              <span>{part.description}</span>
            </li>
          ))}
        </ul>
      );
    }

    case 'graph_chart': {
      const { xLabel, yLabel, series } = data as GraphChartData;
      return (
        <div className="lr-chart">
          {series.map((s, i) => (
            <table className="lr-table" key={i}>
              <caption>{s.name}</caption>
              <thead>
                <tr>
                  <th>{xLabel}</th>
                  <th>{yLabel}</th>
                </tr>
              </thead>
              <tbody>
                {s.points.map((point, j) => (
                  <tr key={j}>
                    <td>{point.x}</td>
                    <td>{point.y}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      );
    }

    case 'verbal_explanation':
    default:
      return null;
  }
}
