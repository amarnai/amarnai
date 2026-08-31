import { useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  type NotificationItem,
} from "@aziru/api-client";
import { useSession } from "../auth/session";
import { useWebAppLink } from "./openWebApp";
import { notificationTitle } from "./notificationText";

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

// Bell + pop-up for the side panel. The pop-up lists recent notifications and
// links out to the web app's full manager (batch actions live there). Opening
// the pop-up marks everything read, matching the web bell.
export function NotificationBell() {
  const { _, i18n } = useLingui();
  const { client, status } = useSession();
  const signedIn = status === "signedIn";
  // "Manage notifications" opens the web app's notifications page in a new tab,
  // already signed in.
  const manageLink = useWebAppLink()("/notifications");
  // Matches the "Settings" pattern: a short visible label at wide panel widths,
  // with the full unambiguous text kept in the aria-label/title.
  const notifLabel = _(msg`Notifications`);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    if (!signedIn) return;
    client
      .notificationsUnreadCount()
      .then(({ count }) => setUnread(count))
      .catch(() => {});
  }, [client, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    refreshCount();
    const interval = setInterval(refreshCount, NOTIFICATION_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [signedIn, refreshCount]);

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
      setLoading(true);
      client
        .notifications(undefined, 30, { undismissedOnly: true })
        .then(({ notifications }) => setItems(notifications))
        .catch(() => {})
        .finally(() => setLoading(false));
      if (unread > 0) {
        setUnread(0);
        client.markAllNotificationsRead().catch(() => {});
      }
    }
  }

  return (
    <div className="ax-notif" ref={rootRef}>
      <button
        type="button"
        className="ax-header-iconbtn"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={notifLabel}
        aria-label={
          unread > 0 ? _(msg`Notifications, ${unread} unread`) : notifLabel
        }
      >
        <span className="ax-notif-icon">
          <BellIcon />
          {unread > 0 && (
            <span className="ax-notif-badge" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        <span className="ax-iconbtn-label">{notifLabel}</span>
      </button>

      {open && (
        <div
          className="ax-notif-panel"
          role="dialog"
          aria-label={_(msg`Notifications`)}
        >
          <div className="ax-notif-header">
            <Trans>Notifications</Trans>
          </div>
          <div className="ax-notif-list">
            {loading && (
              <div className="ax-notif-empty">
                <Trans>Loading…</Trans>
              </div>
            )}
            {!loading && items.length === 0 && (
              <div className="ax-notif-empty">
                <Trans>No notifications yet</Trans>
              </div>
            )}
            {!loading &&
              items.map((n) => (
                <div key={n.id} className={`ax-notif-item${n.readAt ? "" : " is-unread"}`}>
                  {notificationTitle(n, i18n)}
                </div>
              ))}
          </div>
          <a
            className="ax-notif-manage"
            {...manageLink}
            onClick={(e) => {
              setOpen(false);
              manageLink.onClick(e);
            }}
          >
            <Trans>Manage notifications</Trans>
          </a>
        </div>
      )}
    </div>
  );
}
