"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { FolderItem } from "../folder-tree/types.js";
import { FolderTree } from "../folder-tree/FolderTree.js";
import type { ActiveSelection, ThreadItem, SyncInfo, QueueId } from "./types.js";
import { QueueList } from "./QueueList.js";
import { BackfillCard } from "./BackfillCard.js";
import { buildFolderCounts } from "./selection.js";
import { Tooltip } from "../Tooltip.js";

export interface EmailRailProps {
  threads: ThreadItem[];
  folders: FolderItem[];
  active: ActiveSelection;
  railQuery: string;
  openFolderIds: Set<string>;
  // Server-computed per-queue totals; when omitted, QueueList falls back to
  // counting the loaded threads.
  queueCounts?: Partial<Record<QueueId, number>> | undefined;
  syncInfo: SyncInfo;
  onSelectActive: (a: ActiveSelection) => void;
  onRailQueryChange: (q: string) => void;
  onToggleFolder: (id: string) => void;
  onNewFolder?: (() => void) | undefined;
}

export function EmailRail({
  threads,
  folders,
  active,
  railQuery,
  openFolderIds,
  queueCounts,
  syncInfo,
  onSelectActive,
  onRailQueryChange,
  onToggleFolder,
  onNewFolder,
}: EmailRailProps) {
  const { i18n } = useLingui();

  const folderCounts = buildFolderCounts(threads, folders);
  const activeId = active.kind === "folder" ? active.id : null;

  return (
    <aside className="em-rail">
      <div className="em-rail-head">
        <div className="em-rail-head-top">
          <h2><Trans>Mail</Trans></h2>
          {syncInfo?.pushEnabled && (
            <Tooltip content={i18n._(msg`Gmail live sync active`)} placement="bottom">
              <div className="em-sync-chip">
                <span className="em-sync-dot" />
                <span><Trans>Live</Trans></span>
              </div>
            </Tooltip>
          )}
        </div>

        <div className="em-rail-search">
          <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder={i18n._(msg`Filter queues & folders…`)}
            value={railQuery}
            onChange={(e) => onRailQueryChange(e.target.value)}
            aria-label={i18n._(msg`Filter rail`)}
          />
        </div>
      </div>

      <div className="em-rail-scroll">
        <div className="em-section-label">
          <span><Trans>Triage</Trans></span>
        </div>

        <QueueList
          threads={threads}
          folders={folders}
          active={active}
          railQuery={railQuery}
          queueCounts={queueCounts}
          onSelect={onSelectActive}
        />

        <div className="em-section-label">
          <span><Trans>Folders</Trans></span>
          {onNewFolder && (
            <Tooltip content={i18n._(msg`New folder`)}>
              <button
                type="button"
                className="em-add-btn"
                onClick={onNewFolder}
                aria-label={i18n._(msg`New folder`)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </Tooltip>
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

        <BackfillCard syncInfo={syncInfo} />
      </div>
    </aside>
  );
}
