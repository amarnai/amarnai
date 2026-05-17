import { api, type TaxonomyNode } from "@/lib/api";

type TreeNode = TaxonomyNode & { children: TreeNode[] };

function buildTree(nodes: TaxonomyNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const n of nodes) {
    map.set(n.id, { ...n, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId) {
      map.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function NodeRow({ node }: { node: TreeNode }) {
  return (
    <div className="tree-node">
      <div className="node-row">
        <span
          className={`node-kind ${
            node.kind === "CATEGORY" ? "node-kind-category" : "node-kind-rule"
          }`}
        >
          {node.kind === "CATEGORY" ? "CAT" : "RULE"}
        </span>
        <div>
          <div className="node-name">
            {node.name}
            {node.syncToGmail && (
              <span className="badge" style={{ fontSize: 10 }}>
                ⇄ Gmail
              </span>
            )}
          </div>
          {node.description && (
            <div className="node-desc">{node.description}</div>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child) => (
            <NodeRow key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export default async function TaxonomyPage() {
  let nodes: TaxonomyNode[] = [];
  let error: string | null = null;

  try {
    const workspaces = await api.workspaces();
    const ws = workspaces[0];
    if (!ws) throw new Error("No workspace found");
    nodes = await api.taxonomyNodes(ws.id);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const allRoots = buildTree(nodes);
  const categoryRoots = allRoots.filter((n) => n.kind === "CATEGORY");
  const ruleNodes = nodes.filter((n) => n.kind === "RULE");

  return (
    <>
      <h1>Taxonomy</h1>
      {error && <div className="error-box">{error}</div>}

      <h2>Categories</h2>
      {categoryRoots.length === 0 ? (
        <p className="empty">No categories</p>
      ) : (
        categoryRoots.map((root) => <NodeRow key={root.id} node={root} />)
      )}

      {ruleNodes.length > 0 && (
        <div className="section-gap">
          <h2>Rules</h2>
          {ruleNodes.map((rule) => (
            <div key={rule.id} className="tree-node">
              <div className="node-row">
                <span className="node-kind node-kind-rule">RULE</span>
                <div>
                  <div className="node-name">{rule.name}</div>
                  {rule.description && (
                    <div className="node-desc">{rule.description}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
