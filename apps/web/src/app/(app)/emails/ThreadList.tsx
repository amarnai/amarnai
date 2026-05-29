"use client";

import type { ActiveSelection, FolderItem, ThreadItem } from "./selection";
import { filterThreads } from "./selection";
import { ThreadListHeader } from "./ThreadListHeader";
import { ThreadRow } from "./ThreadRow";

type Props = {
  threads: ThreadItem[];
  folders: FolderItem[];
  active: ActiveSelection;
  selectedId: string | null;
  query: string;
  now: Date;
  workspaceEmail: string | null;
  onSelectThread: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onQueryChange: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

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
}: Props) {
  const filtered = filterThreads(threads, folders, active, "all", query, now);
  const unreadCount = filtered.filter((t) => t.unread).length;
  const groups = groupByDate(filtered, now);

  return (
    <div className="em-list-col">
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
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
