"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { api } from "@/lib/api";
import type { NotificationItem } from "@amarnai/api-client";
import { describeNotification } from "@/lib/notifications";
import { switchWorkspaceAction } from "@/actions/workspace";

const PAGE_SIZE = 30;

// ─── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.25" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4.5h10M6.5 4.5V3.5a1 1 0 011-1h1a1 1 0 011 1v1M5 4.5l.5 8a1 1 0 001 .9h3a1 1 0 001-.9l.5-8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 3.5h6.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 3.5l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NotificationsClient({ currentWorkspaceId }: { currentWorkspaceId: string }) {
  const router = useRouter();
  const { i18n, _ } = useLingui();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const loadedOnce = useRef(false);

  // Initial load.
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    api
      .notifications(undefined, PAGE_SIZE)
      .then(({ notifications, nextCursor }) => {
        setItems(notifications);
        setNextCursor(nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    api
      .notifications(nextCursor, PAGE_SIZE)
      .then(({ notifications, nextCursor }) => {
        setItems((prev) => [...prev, ...notifications]);
        setNextCursor(nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((n) => n.id)));
  }

  // ── Mutations (optimistic; server call best-effort) ──────────────────────────

  function applyRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    const at = read ? new Date().toISOString() : null;
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: at } : n)));
    setBusy(true);
    api.updateNotifications(ids, read).catch(() => {}).finally(() => setBusy(false));
  }

  function applyDelete(ids: string[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setItems((prev) => prev.filter((n) => !idSet.has(n.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setBusy(true);
    api.deleteNotifications(ids).catch(() => {}).finally(() => setBusy(false));
  }

  function openThread(n: NotificationItem, threadId: string) {
    if (!n.readAt) applyRead([n.id], true);
    const target = `/emails?t=${encodeURIComponent(threadId)}`;
    // Deep-link into the notification's own workspace: switch first when it
    // differs from the selected one (server action sets the cookie then redirects
    // to the thread), otherwise a soft push suffices.
    if (n.workspaceId !== currentWorkspaceId) {
      void switchWorkspaceAction(n.workspaceId, target);
    } else {
      router.push(target);
    }
  }

  const selectedIds = Array.from(selected);
  const selectedCount = selected.size;

  return (
    <div className="notif-page">
      {/* Selection toolbar */}
      <div className="notif-mgr-toolbar">
        <label className="notif-mgr-selectall">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            disabled={items.length === 0}
            aria-label={_(msg`Select all`)}
          />
          {selectedCount > 0 ? <Trans>{selectedCount} selected</Trans> : <Trans>Select all</Trans>}
        </label>

        {selectedCount > 0 && (
          <div className="notif-mgr-batch">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => applyRead(selectedIds, true)}>
              <Trans>Mark read</Trans>
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => applyRead(selectedIds, false)}>
              <Trans>Mark unread</Trans>
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => applyDelete(selectedIds)}>
              <Trans>Delete</Trans>
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="notif-mgr-list">
        {loading && <div className="notif-mgr-empty"><Trans>Loading…</Trans></div>}
        {!loading && items.length === 0 && (
          <div className="notif-mgr-empty"><Trans>No notifications yet</Trans></div>
        )}
        {!loading &&
          items.map((n) => {
            const view = describeNotification(n, i18n);
            const isUnread = !n.readAt;
            const isExpanded = expanded.has(n.id);
            const isSelected = selected.has(n.id);
            return (
              <div
                key={n.id}
                className={`notif-mgr-item${isUnread ? " is-unread" : ""}${isSelected ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  className="notif-mgr-item-check"
                  checked={isSelected}
                  onChange={() => toggleSelected(n.id)}
                  aria-label={_(msg`Select notification`)}
                />

                <div className="notif-mgr-item-main">
                  <button
                    type="button"
                    className="notif-mgr-item-title"
                    onClick={() => (view.body ? toggleExpanded(n.id) : undefined)}
                    aria-expanded={view.body ? isExpanded : undefined}
                    data-collapsible={view.body ? "true" : "false"}
                  >
                    {view.body && <ChevronIcon open={isExpanded} />}
                    <span className="notif-mgr-item-text">{view.title}</span>
                    {isUnread && <span className="notif-mgr-unread-dot" aria-hidden />}
                  </button>
                  {view.body && isExpanded && <div className="notif-mgr-item-body">{view.body}</div>}
                </div>

                <div className="notif-mgr-item-actions">
                  <button
                    type="button"
                    className="notif-mgr-icon-btn"
                    disabled={busy}
                    onClick={() => applyRead([n.id], isUnread)}
                    title={isUnread ? _(msg`Mark as read`) : _(msg`Mark as unread`)}
                    aria-label={isUnread ? _(msg`Mark as read`) : _(msg`Mark as unread`)}
                  >
                    {isUnread ? <CheckIcon /> : <DotIcon />}
                  </button>
                  {view.threadId && (
                    <button
                      type="button"
                      className="notif-mgr-icon-btn"
                      onClick={() => openThread(n, view.threadId!)}
                      title={_(msg`Open thread`)}
                      aria-label={_(msg`Open thread`)}
                    >
                      <OpenIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    className="notif-mgr-icon-btn notif-mgr-icon-btn--danger"
                    disabled={busy}
                    onClick={() => applyDelete([n.id])}
                    title={_(msg`Delete`)}
                    aria-label={_(msg`Delete`)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}

        {!loading && nextCursor && (
          <div className="notif-mgr-footer">
            <button type="button" className="btn-ghost" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
