"use client";

import type { FolderItem } from "../folder-tree/types.js";
import type { ActiveSelection, ThreadItem } from "./types.js";

const FOLDER_ICO = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);

const CHECK_ICO = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path d="M1.5 5l2.2 2.5L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function fmtTime(d: Date, today: string): string {
  const ds = d.toISOString().slice(0, 10);
  if (ds === today) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface ThreadRowProps {
  thread: ThreadItem;
  folder: FolderItem | undefined;
  active: ActiveSelection;
  selected: boolean;
  workspaceEmail?: string | null | undefined;
  onSelect: () => void;
  onMarkDone: () => void;
  onUnmarkDone: () => void;
}

export function ThreadRow({
  thread,
  folder,
  active,
  selected,
  workspaceEmail,
  onSelect,
  onMarkDone,
  onUnmarkDone,
}: ThreadRowProps) {
  const today = new Date().toISOString().slice(0, 10);
  const confPct = Math.round(thread.confidence * 100);
  const confColor =
    thread.confidence >= 0.8 ? "var(--ok)" : thread.confidence >= 0.6 ? "var(--warn)" : "var(--danger)";

  const inExactFolder =
    active.kind === "folder" && active.id === thread.folderId && thread.status !== "review";

  const chipLabel = thread.status === "review" ? `Wants ${folder?.name ?? "—"}` : (folder?.name ?? "—");
  const chipClass = thread.status === "review" ? "em-route-chip needs-review" : "em-route-chip";
  const isDone = !!thread.doneMark;
  const isClassifying = thread.isClassifying;

  const classes = ["em-thread-row", thread.unread ? "unread" : "", selected ? "selected" : "", isDone ? "done" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      role="row"
    >
      <div className="em-thread-main">
        <div className="em-thread-top">
          <span className="em-thread-from">{thread.participants}</span>
          {thread.messageCount > 1 && <span className="em-msg-count">{thread.messageCount}</span>}
        </div>
        <div className="em-thread-subject">{thread.subject}</div>
        {thread.snippet && <div className="em-thread-snippet">{thread.snippet}</div>}
        <div className="em-thread-meta-row">
          {isDone && (
            <span className="em-pill em-pill--done">
              {CHECK_ICO}
              Done
            </span>
          )}
          {isClassifying ? (
            <span className="em-route-chip sorting">
              <span className="em-chip-spin" aria-hidden />
              Sorting…
            </span>
          ) : !inExactFolder && folder && (
            <span className={chipClass}>
              <span className="em-chip-ico">{FOLDER_ICO}</span>
              {chipLabel}
            </span>
          )}
          {!isDone && (() => {
            const lastIsOwn =
              !!workspaceEmail && !!thread.lastSenderEmail &&
              thread.lastSenderEmail.toLowerCase() === workspaceEmail.toLowerCase();
            if (thread.isDrafting && !lastIsOwn) return <span className="em-pill">Drafting…</span>;
            if (thread.hasDraft && !lastIsOwn) return <span className="em-pill accent">draft</span>;
            return null;
          })()}
          <span className="em-conf">
            <span
              className="em-donut"
              style={{ "--em-conf": thread.confidence, "--em-conf-c": confColor } as React.CSSProperties}
            />
            {confPct}%
          </span>
        </div>
      </div>

      <div className="em-thread-side">
        <div className="em-thread-time">{fmtTime(thread.latestAt, today)}</div>
        <div className="em-thread-actions">
          <button
            type="button"
            className={`em-done-btn${isDone ? " is-done" : ""}`}
            title={isDone ? "Mark as not done" : "Mark as done"}
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            aria-pressed={isDone}
            onClick={(e) => { e.stopPropagation(); isDone ? onUnmarkDone() : onMarkDone(); }}
          >
            {CHECK_ICO}
          </button>
          <a
            href={`https://mail.google.com/mail/u/0/#all/${thread.providerThreadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="em-thread-gmail-link"
            title="Open in Gmail"
            aria-label="Open in Gmail"
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7.5 1H11v3.5M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
