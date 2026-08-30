"use client";

import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { folderInkVar } from "@aziru/core/emails";
import type { FolderItem } from "../folder-tree/types.js";
import type { ActiveSelection } from "./types.js";
import { QUEUES } from "./selection.js";
import { QUEUE_LABELS } from "./queueLabels.js";

export function getFolderAncestry(folderId: string, folders: FolderItem[]): FolderItem[] {
  const chain: FolderItem[] = [];
  let current = folders.find((f) => f.id === folderId);
  while (current) {
    chain.unshift(current);
    const parentId = current.parentId;
    current = parentId ? folders.find((f) => f.id === parentId) : undefined;
  }
  return chain;
}

export interface ThreadListHeaderProps {
  active: ActiveSelection;
  folders: FolderItem[];
  threadCount: number;
  unreadCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  onSelectFolder: (id: string) => void;
  searchRef?: React.RefObject<HTMLInputElement | null> | undefined;
}

export function ThreadListHeader({
  active,
  folders,
  threadCount,
  unreadCount,
  query,
  onQueryChange,
  onSelectFolder,
  searchRef,
}: ThreadListHeaderProps) {
  const { i18n } = useLingui();
  const isFolder = active.kind === "folder";
  const queue = !isFolder ? QUEUES.find((q) => q.id === active.id) : undefined;
  const queueLabel = queue ? QUEUE_LABELS[queue.id] : undefined;

  const title = isFolder
    ? (folders.find((f) => f.id === active.id)?.name ?? "—")
    : (queueLabel ? i18n._(queueLabel.name) : "—");
  const desc = isFolder
    ? (folders.find((f) => f.id === active.id)?.description ??
        i18n._(msg`Threads sorted into this folder by Aziru.`))
    : (queueLabel ? i18n._(queueLabel.desc) : "");

  const ancestry = isFolder ? getFolderAncestry(active.id, folders) : [];
  const activeFolder = isFolder ? folders.find((f) => f.id === active.id) : undefined;

  return (
    <div className="em-list-head">
      <div className="em-list-head-top">
        <div className="em-list-head-meta">
          <div className="em-crumbs">
            <span><Trans>Workspace</Trans></span>
            {isFolder ? (
              ancestry.map((f, i) => (
                <span key={f.id} style={{ display: "contents" }}>
                  <span className="sep">/</span>
                  {i < ancestry.length - 1 ? (
                    <button
                      type="button"
                      className="em-crumb-link"
                      onClick={() => onSelectFolder(f.id)}
                    >
                      {f.name}
                    </button>
                  ) : (
                    <span style={{ color: "var(--ink-2)" }}>{f.name}</span>
                  )}
                </span>
              ))
            ) : (
              <>
                <span className="sep">/</span>
                <span><Trans>Triage</Trans></span>
                <span className="sep">/</span>
                <span style={{ color: "var(--ink-2)" }}>{title}</span>
              </>
            )}
          </div>
          <div className="em-list-title">
            {activeFolder && (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  marginRight: 8,
                  verticalAlign: "middle",
                  background: folderInkVar(activeFolder),
                }}
              />
            )}
            {title}
          </div>
          <div className="em-head-desc">{desc}</div>
        </div>
      </div>

      <div className="em-filter-row">
        <div className="em-filter-search">
          <svg className="icon-l" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder={i18n._(msg`Search ${threadCount} threads`)}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label={i18n._(msg`Search threads`)}
          />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>
        <Plural value={threadCount} one="# thread" other="# threads" />
        {unreadCount > 0 && (
          <>
            {" · "}
            <Trans>{unreadCount} unread</Trans>
          </>
        )}
      </div>
    </div>
  );
}
