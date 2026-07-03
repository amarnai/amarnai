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

// Poll the unread count on this cadence and whenever the tab regains focus. The
// badge is not latency-critical (push covers real-time on mobile), so a light
// poll avoids a per-user SSE channel. Reserved channel for a later SSE upgrade:
// user:{userId}:notifications.
const POLL_MS = 60_000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2a3.5 3.5 0 00-3.5 3.5c0 3-1.2 4-1.5 4.5h10c-.3-.5-1.5-1.5-1.5-4.5A3.5 3.5 0 008 2zM6.5 12.5a1.5 1.5 0 003 0"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NotificationBell({ currentWorkspaceId }: { currentWorkspaceId: string | null }) {
  const router = useRouter();
  const { i18n } = useLingui();
  const { _ } = useLingui();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    api.notificationsUnreadCount()
      .then(({ count }) => setUnread(count))
      .catch(() => {});
  }, []);

  // Poll the count + refresh when the tab regains focus.
  useEffect(() => {
    refreshCount();
    const interval = setInterval(refreshCount, POLL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") refreshCount();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      // Anchor the fixed panel to the bell: open below it and to the right.
      // Fixed positioning escapes the sidebar's overflow clip so the panel can
      // extend into the main content area without being cut off.
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
      // Load the feed and mark everything read on open. The badge clears
      // immediately; the server call is best-effort.
      setLoading(true);
      api.notifications(undefined, 30)
        .then(({ notifications }) => setItems(notifications))
        .catch(() => {})
        .finally(() => setLoading(false));
      if (unread > 0) {
        setUnread(0);
        api.markAllNotificationsRead().catch(() => {});
      }
    }
  }

  function openNotification(n: NotificationItem) {
    setOpen(false);
    const threadId = str(n.params["threadId"]);
    if (!threadId) return;
    const target = `/emails?t=${encodeURIComponent(threadId)}`;
    // The thread lives in the notification's workspace, which may not be the one
    // currently selected. When it differs, switch first (server action: sets the
    // workspace cookie, then redirects to the thread) so the emails page renders
    // the right inbox. Same workspace: a soft push is enough.
    if (currentWorkspaceId && n.workspaceId !== currentWorkspaceId) {
      void switchWorkspaceAction(n.workspaceId, target);
    } else {
      router.push(target);
    }
  }

  function openManager() {
    setOpen(false);
    router.push("/notifications");
  }

  return (
    <div className="notif-bell" ref={rootRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unread > 0
            ? _(msg`Notifications, ${unread} unread`)
            : _(msg`Notifications`)
        }
      >
        <BellIcon />
        {unread > 0 && (
          <span className="notif-bell-badge" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="notif-panel"
          role="dialog"
          aria-label={_(msg`Notifications`)}
          style={pos ? { top: pos.top, left: pos.left } : undefined}
        >
          <div className="notif-panel-header">
            <Trans>Notifications</Trans>
          </div>
          <div className="notif-panel-list">
            {loading && (
              <div className="notif-panel-empty"><Trans>Loading…</Trans></div>
            )}
            {!loading && items.length === 0 && (
              <div className="notif-panel-empty"><Trans>No notifications yet</Trans></div>
            )}
            {!loading && items.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notif-item${n.readAt ? "" : " is-unread"}`}
                onClick={() => openNotification(n)}
              >
                <span className="notif-item-text">{describeNotification(n, i18n).title}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="notif-panel-manage"
            onClick={openManager}
          >
            <Trans>Manage notifications</Trans>
          </button>
        </div>
      )}
    </div>
  );
}
