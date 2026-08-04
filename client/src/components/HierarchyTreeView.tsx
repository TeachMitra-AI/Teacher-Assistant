// Learning Representation — hierarchy_diagram (ADR Phase D2). A pure-CSS
// org-chart tree: connector lines drawn entirely with :before/:after on
// each <li>, no SVG and no layout library. A well-established technique
// (float-based, not flex) chosen specifically because it self-sizes
// correctly for an arbitrary, data-driven tree shape without any
// measurement code — flex/grid equivalents need JS to get sibling
// connectors right when node widths vary.
//
// Wrapped in a horizontally-scrolling container: a wide tree (many
// siblings) growing past the panel's width scrolls in place rather than
// breaking the page layout.
import type { HierarchyDiagramData } from '../types';

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

function TreeBranch({ node }: { node: TreeNode }) {
  return (
    <li>
      <div className="lr-tree-node">{node.label}</div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeBranch key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function HierarchyTreeView({ data }: { data: HierarchyDiagramData }) {
  const root = buildTree(data.nodes);
  if (!root) return null;
  return (
    <div className="lr-tree-scroll">
      <ul className="lr-tree">
        <TreeBranch node={root} />
      </ul>
    </div>
  );
}
