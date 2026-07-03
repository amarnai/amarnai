"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { FolderItem } from "../folder-tree/types.js";
import type { ActiveSelection, ThreadItem } from "./types.js";
import { ThreadListHeader } from "./ThreadListHeader.js";
import { ThreadRow } from "./ThreadRow.js";

type DateGroupKey = "today" | "yesterday" | "earlier";

const DATE_GROUP_LABELS: Record<DateGroupKey, MessageDescriptor> = {
  today: msg`Today`,
  yesterday: msg`Yesterday`,
  earlier: msg`Earlier`,
};

function groupByDate(
  threads: ThreadItem[],
  now: Date,
): { key: DateGroupKey; items: ThreadItem[] }[] {
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

  const groups: { key: DateGroupKey; items: ThreadItem[] }[] = [];
  if (todayItems.length) groups.push({ key: "today", items: todayItems });
  if (yestItems.length) groups.push({ key: "yesterday", items: yestItems });
  if (earlierItems.length) groups.push({ key: "earlier", items: earlierItems });
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
  /** True when the workspace has ≥2 members (assign affordances are shown). */
  canAssign?: boolean;
  /** Open the member picker for a thread, anchored to the passed element. */
  onOpenAssign?: (threadId: string, anchor: HTMLElement) => void;
  railOpen?: boolean;
  onToggleRail?: () => void;
  // Pagination: a footer shows "X of Y loaded" with an explicit Load more button,
  // and an intersection sentinel auto-loads as it scrolls into view. `total` is
  // the server's inbox-visible thread count.
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  total?: number;
  // True while the historical backfill is still fetching past threads from
  // Gmail. When the list is empty because of this, show a loading state
  // instead of the "no threads" empty message.
  backfilling?: boolean;
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
  canAssign,
  onOpenAssign,
  railOpen,
  onToggleRail,
  hasMore,
  loadingMore,
  onLoadMore,
  total,
  backfilling,
}: ThreadListProps) {
  // The list is already filtered server-side (active view + search), so render
  // the loaded threads directly. `total` is the server count for "X threads".
  const { i18n } = useLingui();
  const viewCount = total ?? threads.length;
  const unreadCount = threads.filter((t) => t.unread).length;
  const groups = groupByDate(threads, now);

  return (
    <div className="em-list-col">
      {onToggleRail && (
        <div className="em-nav-toggle">
          <button
            type="button"
            className="em-rail-toggle-btn"
            onClick={onToggleRail}
            aria-pressed={railOpen}
            aria-label={i18n._(msg`Toggle folders`)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
            >
              <path
                d="M1 2h4.5l1 1.5H11a.5.5 0 01.5.5v5.5a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V2.5A.5.5 0 011 2z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <Trans>Folders</Trans>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden
              style={{
                marginLeft: 2,
                transition: "transform 0.18s ease",
                transform: railOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              <path
                d="M2 3.5l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
      <ThreadListHeader
        active={active}
        folders={folders}
        threadCount={viewCount}
        unreadCount={unreadCount}
        query={query}
        onQueryChange={onQueryChange}
        onSelectFolder={onSelectFolder}
        searchRef={searchRef}
      />

      <div className="em-list-scroll">
        {threads.length === 0 && (
          <div className="em-empty">
            {query ? (
              <Trans>No threads match your search.</Trans>
            ) : backfilling ? (
              <span className="em-empty-loading">
                <span className="em-chip-spin" aria-hidden />
                <Trans>Loading past threads…</Trans>
              </span>
            ) : (
              <Trans>No threads here.</Trans>
            )}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.key} className="em-group">
            <div className="em-group-label">
              {i18n._(DATE_GROUP_LABELS[group.key])}
            </div>
            <div
              className="em-group-list"
              role="list"
              aria-label={i18n._(DATE_GROUP_LABELS[group.key])}
            >
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
                    {...(canAssign !== undefined ? { canAssign } : {})}
                    {...(onOpenAssign
                      ? { onOpenAssign: (anchor: HTMLElement) => onOpenAssign(thread.id, anchor) }
                      : {})}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Pages auto-load up to a cap; past it this footer shows progress and
            an explicit Load more. A fully-loaded list shows nothing; the queue
            pills carry the authoritative totals. */}
        {hasMore && threads.length > 0 && (
          <div className="em-list-footer">
            <span className="em-list-count">
              <Trans>
                {threads.length.toLocaleString()} of{" "}
                {viewCount.toLocaleString()} loaded
              </Trans>
            </span>
            <button
              type="button"
              className="em-load-more"
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
