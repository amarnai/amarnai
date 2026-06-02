"use client";

import type { SyncStatus } from "@/lib/api";
import type { ActiveSelection, FolderItem, ThreadItem } from "./selection";
import { QueueList } from "./QueueList";
import { FolderTree } from "./FolderTree";
import { BackfillCard } from "./BackfillCard";

type Props = {
  threads: ThreadItem[];
  folders: FolderItem[];
  active: ActiveSelection;
  railQuery: string;
  openFolderIds: Set<string>;
  syncStatus: SyncStatus;
  now: Date;
  onSelectActive: (a: ActiveSelection) => void;
  onRailQueryChange: (q: string) => void;
  onToggleFolder: (id: string) => void;
  onNewFolder: () => void;
};

export function Rail({
  threads,
  folders,
  active,
  railQuery,
  openFolderIds,
  syncStatus,
  now,
  onSelectActive,
  onRailQueryChange,
  onToggleFolder,
  onNewFolder,
}: Props) {
  const lastSync = syncStatus?.lastSyncedAt
    ? formatSyncAge(new Date(syncStatus.lastSyncedAt), now)
    : null;

  return (
    <aside className="em-rail">
      <div className="em-rail-head">
        <div className="em-rail-head-top">
          <h2>Mail</h2>
          {lastSync && (
            <div className="em-sync-chip" title={`Last synced with Gmail ${lastSync} ago`} suppressHydrationWarning>
              <span className="em-sync-dot" />
              <span suppressHydrationWarning>{lastSync}</span>
            </div>
          )}
        </div>

        <div className="em-rail-search">
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Filter queues & folders…"
            value={railQuery}
            onChange={(e) => onRailQueryChange(e.target.value)}
            aria-label="Filter rail"
          />
        </div>
      </div>

      <div className="em-rail-scroll">
        <div className="em-section-label">
          <span>Triage</span>
        </div>

        <QueueList
          threads={threads}
          folders={folders}
          active={active}
          railQuery={railQuery}
          now={now}
          onSelect={onSelectActive}
        />

        <div className="em-section-label">
          <span>Folders</span>
          <button
            type="button"
            className="em-add-btn"
            title="New folder (G then F)"
            onClick={onNewFolder}
            aria-label="New folder"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <FolderTree
          folders={folders}
          threads={threads}
          active={active}
          openIds={openFolderIds}
          railQuery={railQuery}
          now={now}
          onToggle={onToggleFolder}
          onSelect={(id) => onSelectActive({ kind: "folder", id })}
        />

        <BackfillCard syncStatus={syncStatus} />
      </div>
    </aside>
  );
}

function formatSyncAge(d: Date, now: Date): string {
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}
