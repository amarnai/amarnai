"use client";

import type { FolderItem } from "../folder-tree/types.js";
import type { ActiveSelection, ThreadItem } from "./types.js";
import { QUEUES, countForActive } from "./selection.js";

const ICON_SVG: Record<string, string> = {
  all: `<path d="M2 8v2.5A1.5 1.5 0 0 0 3.5 12h7A1.5 1.5 0 0 0 12 10.5V8M2 8h3l1 1.5h2L9 8h3M2 8l1.5-4.5A1.5 1.5 0 0 1 4.9 2.4h4.2a1.5 1.5 0 0 1 1.4 1.1L12 8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
  sorted: `<circle cx="7" cy="7" r="5.3" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 7l2 2 3-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  review: `<circle cx="7" cy="7" r="5.3" stroke="currentColor" stroke-width="1.3"/><path d="M7 4.4v3M7 9.6h.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
  pending: `<circle cx="7" cy="7" r="5.3" stroke="currentColor" stroke-width="1.3"/><path d="M7 4v3.2l2 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  important: `<path d="M7 2l1.4 3h3.1l-2.5 1.9 1 3.1L7 8.2l-3 1.8 1-3.1L2.5 5H5.6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
};

export interface QueueListProps {
  threads: ThreadItem[];
  folders: FolderItem[];
  active: ActiveSelection;
  railQuery: string;
  onSelect: (a: ActiveSelection) => void;
}

export function QueueList({ threads, folders, active, railQuery, onSelect }: QueueListProps) {
  const q = railQuery.trim().toLowerCase();
  const visible = q ? QUEUES.filter((x) => x.name.toLowerCase().includes(q)) : QUEUES;

  return (
    <>
      {visible.map((queue) => {
        const isActive = active.kind === "queue" && active.id === queue.id;
        const count = countForActive(threads, folders, { kind: "queue", id: queue.id });
        return (
          <button
            key={queue.id}
            type="button"
            className={`em-queue-item${isActive ? " active" : ""}${queue.warn ? " warn" : ""}`}
            onClick={() => onSelect({ kind: "queue", id: queue.id })}
          >
            <span className="em-qi-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: ICON_SVG[queue.id] ?? "" }}
              />
            </span>
            <span>{queue.name}</span>
            <span className="em-qi-count">{count}</span>
          </button>
        );
      })}
    </>
  );
}
