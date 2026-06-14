"use client";

import { TAXONOMY_MIN_NON_ROOT_NODES } from "@amarnai/shared";
import type { FolderItem } from "../folder-tree/types.js";
import type { ThreadItem } from "./types.js";

const EMBEDDING_SOURCES = new Set(["embedding_auto", "embedding_inbox", "inbox_fallback"]);

function isEmbeddingExplanation(source: string | null, text: string | null): boolean {
  if (!text) return false;
  if (source !== null) return EMBEDDING_SOURCES.has(source);
  return text.startsWith("Embedding routing to") || text.startsWith("No child branch matched confidently");
}

export interface RationaleCardProps {
  thread: ThreadItem;
  folders: FolderItem[];
  decisionSource: string | null;
  /** Non-root taxonomy nodes reachable from the root. Drives the waiting copy. */
  routableNodeCount: number;
  onApprove?: (() => void) | undefined;
  onReroute?: ((anchor: HTMLElement) => void) | undefined;
}

export function RationaleCard({
  thread,
  folders,
  decisionSource,
  routableNodeCount,
  onApprove,
  onReroute,
}: RationaleCardProps) {
  const folder = folders.find((f) => f.id === thread.folderId);
  const unrouted = !folder;
  const confPct = Math.round(thread.confidence * 100);
  const altFolder = thread.alternativeFolder
    ? folders.find((f) => f.id === thread.alternativeFolder?.folderId)
    : null;

  if (thread.isClassifying) {
    return (
      <div className="em-rationale-card sorting">
        <div className="em-rationale-header">
          <span className="em-rationale-label">AI Routing</span>
        </div>
        <div className="em-rationale-dest">
          <span className="em-chip-spin" aria-hidden />
          <span>Sorting…</span>
        </div>
      </div>
    );
  }

  // Waiting state: the thread has not been routed and is not actively sorting.
  // This covers PENDING threads (synced while the taxonomy was too weak, or not
  // yet manually routed) and legacy UNROUTED threads. Routing never starts
  // automatically for these — the user triggers it with "Route now".
  const taxonomyWeak = routableNodeCount < TAXONOMY_MIN_NON_ROOT_NODES;
  if (thread.status === "unrouted" || thread.status === "unsorted") {
    return (
      <div className="em-rationale-card unrouted">
        <div className="em-rationale-header">
          <span className="em-rationale-label">AI Routing</span>
        </div>
        <div className="em-rationale-dest">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 5.5v3M6 3.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span>Waiting</span>
        </div>
        <div className="em-rationale-reason em-rationale-reason--muted">
          {taxonomyWeak
            ? `This thread cannot be sorted yet. Add at least ${TAXONOMY_MIN_NON_ROOT_NODES} categories to your taxonomy to begin routing.`
            : "This thread is waiting to be routed. Use “Route now” to start sorting."}
        </div>
      </div>
    );
  }

  return (
    <div className={`em-rationale-card${unrouted ? " unrouted" : ""}`}>
      <div className="em-rationale-header">
        <span className="em-rationale-label">AI Routing</span>
        <span className="em-rationale-conf">{confPct}% confidence</span>
      </div>

      <div className="em-rationale-dest">
        {unrouted ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 5.5v3M6 3.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          </svg>
        )}
        <span>{folder?.name ?? "Unrouted"}</span>
      </div>

      {thread.isImportant && (
        <div className="em-rationale-important">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1.5l1.7 3.5 3.8.55-2.75 2.68.65 3.77L7 10.1l-3.42 1.9.65-3.77L1.5 5.55 5.3 5z" fill="currentColor" />
          </svg>
          Gmail marked as important
        </div>
      )}

      {isEmbeddingExplanation(decisionSource, thread.reasoning) ? (
        <div className="em-rationale-reason em-rationale-reason--muted">
          Sorted automatically by content similarity.
        </div>
      ) : thread.reasoning ? (
        <div className="em-rationale-reason">{thread.reasoning}</div>
      ) : null}

      {altFolder && thread.alternativeFolder && (
        <div className="em-rationale-alt">
          Runner-up: <strong>{altFolder.name}</strong>{" "}
          ({Math.round(thread.alternativeFolder.weight * 100)}%)
        </div>
      )}

      <div className="em-rationale-actions">
        {thread.status !== "sorted" && !unrouted && onApprove && (
          <button type="button" className="em-btn-primary" onClick={onApprove}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ verticalAlign: -1, marginRight: 4 }}>
              <path d="M1.5 5l2.2 2.5L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Approve routing
          </button>
        )}
        {onReroute && (
          <button
            type="button"
            className="em-btn-secondary"
            onClick={(e) => onReroute(e.currentTarget)}
          >
            Move to…
          </button>
        )}
      </div>
    </div>
  );
}
