"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TaxonomyNode, TaxonomyEdge, EmailThreadSummary } from "@/lib/api";

type FolderNode = {
  id: string;
  name: string;
  threadCount: number;
  children: FolderNode[];
};

function buildFolderTree(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[],
  threads: EmailThreadSummary[]
): FolderNode[] {
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    childrenMap.set(node.id, []);
  }
  for (const edge of edges) {
    const list = childrenMap.get(edge.sourceNodeId);
    if (list) list.push(edge.targetNodeId);
  }

  const threadCountByNode = new Map<string, number>();
  for (const thread of threads) {
    const nodeId = thread.latestClassification?.finalNode?.id;
    if (nodeId) {
      threadCountByNode.set(nodeId, (threadCountByNode.get(nodeId) ?? 0) + 1);
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();

  function getVisibleChildren(nodeId: string): FolderNode[] {
    const childIds = childrenMap.get(nodeId) ?? [];
    const result: FolderNode[] = [];
    for (const childId of childIds) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = nodeById.get(childId);
      if (!child) continue;
      if (child.isVisibleCategory) {
        result.push({
          id: child.id,
          name: child.name,
          threadCount: threadCountByNode.get(child.id) ?? 0,
          children: getVisibleChildren(child.id),
        });
      } else {
        result.push(...getVisibleChildren(child.id));
      }
    }
    return result;
  }

  const root = nodes.find((n) => n.isRoot);
  if (!root) return [];
  visited.add(root.id);

  if (root.isVisibleCategory) {
    return [
      {
        id: root.id,
        name: root.name,
        threadCount: threadCountByNode.get(root.id) ?? 0,
        children: getVisibleChildren(root.id),
      },
    ];
  }
  return getVisibleChildren(root.id);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type FolderRowProps = {
  folder: FolderNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string | null) => void;
};

function FolderRow({
  folder,
  depth,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
}: FolderRowProps) {
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedId === folder.id;
  const hasChildren = folder.children.length > 0;

  return (
    <div className="folder-item">
      <button
        className={`folder-row-btn${isSelected ? " active" : ""}`}
        style={{ paddingLeft: 10 + depth * 18 }}
        onClick={() => onSelect(isSelected ? null : folder.id)}
      >
        <span
          className="folder-toggle"
          role="button"
          aria-label={isExpanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(folder.id);
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count">{folder.threadCount}</span>
      </button>
      {hasChildren && isExpanded && (
        <div>
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
};

export default function FoldersSection({ nodes, edges, threads }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tree = useMemo(
    () => buildFolderTree(nodes, edges, threads),
    [nodes, edges, threads]
  );

  const sortedThreads = useMemo(
    () => threads.filter((t) => t.latestClassification !== null),
    [threads]
  );

  const visibleThreads = useMemo(() => {
    if (selectedId === null) return sortedThreads;
    return threads.filter(
      (t) => t.latestClassification?.finalNode?.id === selectedId
    );
  }, [selectedId, sortedThreads, threads]);

  function handleToggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelect(id: string | null) {
    setSelectedId(id);
  }

  return (
    <div className="folders-section">
      <div className="folders-tree-panel card">
        <button
          className={`folder-all-btn${selectedId === null ? " active" : ""}`}
          onClick={() => handleSelect(null)}
        >
          <span className="folder-name">All sorted</span>
          <span className="folder-count">{sortedThreads.length}</span>
        </button>
        <div className="folders-divider" />
        {tree.length === 0 ? (
          <p style={{ padding: "12px 14px", color: "#9ca3af", fontSize: 13 }}>
            No folders defined
          </p>
        ) : (
          <div className="folder-tree">
            {tree.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                depth={0}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onToggle={handleToggle}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </div>

      <div className="folders-thread-panel">
        {visibleThreads.length === 0 ? (
          <p className="empty">No threads</p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
