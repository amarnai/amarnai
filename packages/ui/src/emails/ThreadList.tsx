"use client";

import type { FolderItem } from "../folder-tree/types.js";
import type { ActiveSelection, ThreadItem } from "./types.js";
import { filterThreads } from "./selection.js";
import { ThreadListHeader } from "./ThreadListHeader.js";
import { ThreadRow } from "./ThreadRow.js";

function groupByDate(threads: ThreadItem[], now: Date): { label: string; items: ThreadItem[] }[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const todayItems: ThreadItem[] = [];
  const yestItems: ThreadItem[] = [];
  const earlierItems: ThreadItem[] = [];

  for (const t of threads) {
    const d = t.latestAt.toISOString().slice(0, 10);
    if (d === today) todayItems.push(t);
    else if (d === yesterdayStr) yestItems.push(t);
    else earlierItems.push(t);
  }

  const groups: { label: string; items: ThreadItem[] }[] = [];
  if (todayItems.length) groups.push({ label: "Today", items: todayItems });
  if (yestItems.length) groups.push({ label: "Yesterday", items: yestItems });
  if (earlierItems.length) groups.push({ label: "Earlier", items: earlierItems });
  return groups;
}

export interface ThreadListProps {
  threads: ThreadItem[];
  folders: FolderItem[];
  active: ActiveSelection;
  selectedId: string | null;
  query: string;
  now: Date;
  workspaceEmail?: string | null | undefined;
  onSelectThread: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onQueryChange: (q: string) => void;
  searchRef?: React.RefObject<HTMLInputElement | null> | undefined;
  onMarkDone: (threadId: string) => void;
  onUnmarkDone: (threadId: string) => void;
  railOpen?: boolean;
  onToggleRail?: () => void;
}

export function ThreadList({
  threads,
  folders,
  active,
  selectedId,
  query,
  now,
  workspaceEmail,
  onSelectThread,
  onSelectFolder,
  onQueryChange,
  searchRef,
  onMarkDone,
  onUnmarkDone,
  railOpen,
  onToggleRail,
}: ThreadListProps) {
  const filtered = filterThreads(threads, folders, active, "all", query);
  const unreadCount = filtered.filter((t) => t.unread).length;
  const groups = groupByDate(filtered, now);

  return (
    <div className="em-list-col">
      {onToggleRail && (
        <div className="em-nav-toggle">
          <button
            type="button"
            className="em-rail-toggle-btn"
            onClick={onToggleRail}
            aria-pressed={railOpen}
            aria-label="Toggle folders"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1 2h4.5l1 1.5H11a.5.5 0 01.5.5v5.5a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V2.5A.5.5 0 011 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            Folders
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden style={{ marginLeft: 2, transition: "transform 0.18s ease", transform: railOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      <ThreadListHeader
        active={active}
        folders={folders}
        threadCount={filtered.length}
        unreadCount={unreadCount}
        query={query}
        onQueryChange={onQueryChange}
        onSelectFolder={onSelectFolder}
        searchRef={searchRef}
      />

      <div className="em-list-scroll" role="grid" aria-label="Email threads">
        {filtered.length === 0 && (
          <div className="em-empty">
            {query ? "No threads match your search." : "No threads here."}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="em-group">
            <div className="em-group-label">{group.label}</div>
            {group.items.map((thread) => {
              const folder = folders.find((f) => f.id === thread.folderId);
              return (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  folder={folder}
                  active={active}
                  selected={thread.id === selectedId}
                  workspaceEmail={workspaceEmail}
                  onSelect={() => onSelectThread(thread.id)}
                  onMarkDone={() => onMarkDone(thread.id)}
                  onUnmarkDone={() => onUnmarkDone(thread.id)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
