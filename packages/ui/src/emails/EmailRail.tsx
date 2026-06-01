"use client";

import type { FolderItem } from "../folder-tree/types.js";
import { FolderTree } from "../folder-tree/FolderTree.js";
import type { ActiveSelection, ThreadItem, SyncInfo } from "./types.js";
import { QueueList } from "./QueueList.js";
import { BackfillCard } from "./BackfillCard.js";
import { buildFolderCounts } from "./selection.js";

function formatSyncAge(d: Date, now: Date): string {
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

export interface EmailRailProps {
  threads: ThreadItem[];
  folders: FolderItem[];
  active: ActiveSelection;
  railQuery: string;
  openFolderIds: Set<string>;
  syncInfo: SyncInfo;
  now: Date;
  onSelectActive: (a: ActiveSelection) => void;
  onRailQueryChange: (q: string) => void;
  onToggleFolder: (id: string) => void;
  onNewFolder?: (() => void) | undefined;
  upgradeHref?: string | undefined;
}

export function EmailRail({
  threads,
  folders,
  active,
  railQuery,
  openFolderIds,
  syncInfo,
  now,
  onSelectActive,
  onRailQueryChange,
  onToggleFolder,
  onNewFolder,
  upgradeHref,
}: EmailRailProps) {
  const lastSync =
    syncInfo?.lastSyncedAt
      ? formatSyncAge(new Date(syncInfo.lastSyncedAt), now)
      : null;

  const folderCounts = buildFolderCounts(threads, folders);
  const activeId = active.kind === "folder" ? active.id : null;

  return (
    <aside className="em-rail">
      <div className="em-rail-head">
        <div className="em-rail-head-top">
          <h2>Mail</h2>
          {lastSync && (
            <div className="em-sync-chip" title={`Last Gmail sync ${lastSync} ago`}>
              <span className="em-sync-dot" />
              <span>{lastSync}</span>
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
          onSelect={onSelectActive}
        />

        <div className="em-section-label">
          <span>Folders</span>
          {onNewFolder && (
            <button
              type="button"
              className="em-add-btn"
              title="New folder"
              onClick={onNewFolder}
              aria-label="New folder"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        <FolderTree
          folders={folders}
          counts={folderCounts}
          activeId={activeId}
          openIds={openFolderIds}
          query={railQuery}
          onToggle={onToggleFolder}
          onSelect={(id) => onSelectActive({ kind: "folder", id })}
        />

        <BackfillCard syncInfo={syncInfo} upgradeHref={upgradeHref} />
      </div>
    </aside>
  );
}
