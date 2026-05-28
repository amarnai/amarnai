"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TaxonomyNode, TaxonomyEdge, EmailThreadSummary } from "@/lib/api";

type FolderNode = {
  id: string;
  name: string;
  description: string | null;
  threadCount: number;
  children: FolderNode[];
};

function buildTree(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[],
  folderCounts: Record<string, number>
): { root: TaxonomyNode | null; topLevelIds: string[]; tree: FolderNode[] } {
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) childrenMap.set(node.id, []);
  for (const edge of edges) {
    childrenMap.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();

  function getChildren(nodeId: string): FolderNode[] {
    const result: FolderNode[] = [];
    for (const childId of childrenMap.get(nodeId) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = nodeById.get(childId);
      if (!child) continue;
      result.push({
        id: child.id,
        name: child.name,
        description: child.description,
        threadCount: folderCounts[child.id] ?? 0,
        children: getChildren(child.id),
      });
    }
    return result;
  }

  const root = nodes.find((n) => n.isRoot) ?? null;
  if (!root) return { root: null, topLevelIds: [], tree: [] };
  visited.add(root.id);
  const tree = getChildren(root.id);
  return { root, topLevelIds: tree.map((f) => f.id), tree };
}

function buildBreadcrumb(
  selectedId: string,
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): string[] {
  const parentMap = new Map<string, string>();
  for (const edge of edges) parentMap.set(edge.targetNodeId, edge.sourceNodeId);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const path: string[] = [];
  let cur: string | undefined = selectedId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = nodeById.get(cur);
    if (n) path.unshift(n.name);
    cur = parentMap.get(cur);
  }
  return path;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type RowProps = {
  folder: FolderNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string | null) => void;
};

function FolderRow({ folder, depth, selectedId, expandedIds, onToggle, onSelect }: RowProps) {
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedId === folder.id;
  const hasChildren = folder.children.length > 0;

  return (
    <div>
      <button
        className={`fb-row${isSelected ? " active" : ""}`}
        style={{ paddingLeft: 12 + depth * 18 }}
        onClick={() => onSelect(isSelected ? null : folder.id)}
      >
        <span
          className="fb-toggle"
          role="button"
          aria-label={isExpanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(folder.id);
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span className="fb-name">{folder.name}</span>
        {folder.threadCount > 0 && (
          <span className="fb-count">{folder.threadCount}</span>
        )}
      </button>
      {hasChildren && isExpanded && (
        <div
          className="fb-children"
          style={{ marginLeft: 12 + depth * 18 + 7 }}
        >
          {folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Props = {
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  threads: EmailThreadSummary[];
  folderCounts: Record<string, number>;
  totalClassified: number;
};

export default function FolderBrowser({ nodes, edges, threads, folderCounts, totalClassified }: Props) {
  const { root, topLevelIds, tree } = useMemo(
    () => buildTree(nodes, edges, folderCounts),
    [nodes, edges, folderCounts]
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(topLevelIds)
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const breadcrumb = useMemo(
    () => (selectedId ? buildBreadcrumb(selectedId, nodes, edges) : []),
    [selectedId, nodes, edges]
  );

  const selectedNode = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, nodes]
  );

  const classifiedThreads = useMemo(
    () => threads.filter((t) => t.latestClassification !== null),
    [threads]
  );

  const visibleThreads = useMemo(() => {
    if (selectedId === null) return classifiedThreads;
    return threads.filter(
      (t) => t.latestClassification?.finalNode?.id === selectedId
    );
  }, [selectedId, classifiedThreads, threads]);

  function handleToggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const detailTitle = selectedNode?.name ?? root?.name ?? "All sorted";
  const detailDesc = selectedNode?.description ?? null;
  const parentCrumb = breadcrumb.length > 1 ? breadcrumb.slice(0, -1).join(" › ") : null;

  return (
    <div className="fb-panel">
      {/* ── Tree panel ── */}
      <div className="fb-tree-panel card">
        <button
          className={`fb-root-btn${selectedId === null ? " active" : ""}`}
          onClick={() => setSelectedId(null)}
        >
          <span className="fb-name">{root?.name ?? "All sorted"}</span>
          <span className="fb-count">{totalClassified}</span>
        </button>

        <div className="folders-divider" />

        {tree.length === 0 ? (
          <p className="fb-empty-tree">No folders defined</p>
        ) : (
          <div className="fb-tree">
            {tree.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                depth={0}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onToggle={handleToggle}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      <div className="fb-detail">
        <div className="fb-detail-header">
          {parentCrumb && <div className="fb-breadcrumb">{parentCrumb}</div>}
          <div className="fb-detail-title">{detailTitle}</div>
          {detailDesc && <div className="fb-detail-desc">{detailDesc}</div>}
        </div>

        {visibleThreads.length === 0 ? (
          <p className="empty">No threads</p>
        ) : (
          <>
            <div className="card">
              {visibleThreads.map((thread) => {
                const sender = thread.messages[0];
                const cls = thread.latestClassification;
                return (
                  <Link
                    key={thread.id}
                    href={`/emails/${thread.id}`}
                    className="thread-row"
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="thread-subject">
                        {thread.subject ?? "(no subject)"}
                        {cls?.needsHumanReview && (
                          <span
                            className="review-dot"
                            title="Review needed"
                            aria-label="Review needed"
                          />
                        )}
                      </div>
                      <div className="thread-meta">
                        {sender?.senderName ?? sender?.senderEmail ?? "Unknown"}
                        {" · "}
                        {fmtDate(thread.latestMessageAt)}
                        {cls !== null && (
                          <>
                            {" · "}
                            <span className="badge" style={{ fontSize: 10 }}>
                              {Math.round(cls.confidence * 100)}%
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
            {selectedId && (
              <div className="fb-view-all">
                <Link
                  href={`/emails?nodeId=${selectedId}`}
                  className="fb-view-all-link"
                >
                  View all in Emails →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
