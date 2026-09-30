// Learning Representation: hierarchy_diagram. A pure-CSS org-chart tree with connectors drawn by :before/:after on each <li>,
// no SVG or layout library. The float-based technique self-sizes for an arbitrary data-driven tree without measurement code
// (flex/grid need JS for sibling connectors when node widths vary). Wrapped in a horizontally scrolling container so a wide
// tree scrolls in place instead of breaking the layout.
import type { HierarchyDiagramData } from '../types';

interface HierarchyNode {
  id: string;
  label: string;
  parentId: string | null;
}
interface TreeNode extends HierarchyNode {
  children: TreeNode[];
}

// The server already validated exactly one root and resolvable parentIds (schemas.js), so this rebuilds the tree trusting that.
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
