"use client";

import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { FolderItem } from "../folder-tree/types.js";
import type { ThreadItem } from "./types.js";
import { buildThreadUrl } from "@amarnai/core/emails";
import { openInProviderLabel } from "./providerLabels.js";
import { Tooltip } from "../Tooltip.js";
import { GmailIcon } from "../icons/GmailIcon.js";
import { OutlookIcon } from "../icons/OutlookIcon.js";

const FOLDER_ICO = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path
      d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
);

const CHECK_ICO = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path
      d="M1.5 5l2.2 2.5L8.5 2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CLIP_ICO = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path
      d="M10 5.5 6 9.5a3 3 0 01-4.24-4.24L6.5 1a2 2 0 012.83 2.83L4.58 8.58a1 1 0 01-1.41-1.41L8 2.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PERSON_ICO = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
    <circle cx="6" cy="3.6" r="2.1" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M2 10.2c0-2.1 1.8-3.4 4-3.4s4 1.3 4 3.4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

// Five-point star. Filled when the thread is marked important; outline otherwise.
function StarIco({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7 1.75l1.545 3.13 3.455.502-2.5 2.437.59 3.44L7 9.63l-3.09 1.625.59-3.44-2.5-2.437 3.455-.502z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fmtTime(d: Date, today: string): string {
  const ds = d.toISOString().slice(0, 10);
  if (ds === today) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const currentYear = Number(today.slice(0, 4));
  if (d.getFullYear() !== currentYear) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface ThreadRowProps {
  thread: ThreadItem;
  folder: FolderItem | undefined;
  selected: boolean;
  workspaceEmail?: string | null | undefined;
  onSelect: () => void;
  onMarkDone: () => void;
  onUnmarkDone: () => void;
  /** Toggle the user-marked "important" star. */
  onToggleImportant: () => void;
  /** True when the workspace has ≥2 members (assign affordances are shown). */
  canAssign?: boolean;
  /** Open the member picker anchored to the passed element. */
  onOpenAssign?: (anchor: HTMLElement) => void;
  /** Open the move-to-folder picker anchored to the passed element. Makes the
   * folder chip clickable; without it the chip is a static tag. */
  onReroute?: (anchor: HTMLElement) => void;
  /**
   * When set, the Gmail icon routes through this callback instead of opening a
   * new tab via a plain link. The browser extension uses it to reuse/activate an
   * existing Gmail tab; the web app leaves it unset and keeps the target="_blank"
   * link (a web page can't reuse or focus another tab).
   */
  onOpenInGmail?: () => void;
}

export function ThreadRow({
  thread,
  folder,
  selected,
  workspaceEmail,
  onSelect,
  onMarkDone,
  onUnmarkDone,
  onToggleImportant,
  canAssign,
  onOpenAssign,
  onReroute,
  onOpenInGmail,
}: ThreadRowProps) {
  const { i18n } = useLingui();
  const today = new Date().toISOString().slice(0, 10);

  const folderName = folder?.name ?? "—";
  const chipLabel =
    thread.status === "review" ? i18n._(msg`Wants ${folderName}`) : folderName;
  const chipClass =
    thread.status === "review" ? "em-route-chip needs-review" : "em-route-chip";
  const isDone = !!thread.doneMark;
  const isClassifying = thread.isClassifying;
  const markDoneLabel = isDone
    ? i18n._(msg`Mark as not done`)
    : i18n._(msg`Mark as done`);
  const importantLabel = thread.isImportant
    ? i18n._(msg`Remove from important`)
    : i18n._(msg`Mark as important`);
  const openInGmailLabel = openInProviderLabel(i18n, thread.provider);
  // The "open in provider" action shows the destination's brand mark so it's
  // clear at a glance whether the thread opens in Gmail or Outlook.
  const providerIcon =
    thread.provider === "OUTLOOK" ? (
      <OutlookIcon variant="color" size={14} />
    ) : (
      <GmailIcon variant="color" size={14} />
    );

  // The folder chip doubles as the move-to-folder control: clicking it opens
  // the folder picker anchored to the chip. Falls back to a static tag when
  // the parent wired no reroute handler.
  const moveChip = (className: string, ariaLabel: string, children: ReactNode) =>
    onReroute ? (
      <Tooltip content={i18n._(msg`Change folder`)}>
        <button
          type="button"
          className={className}
          aria-label={ariaLabel}
          onClick={(e) => {
            e.stopPropagation();
            onReroute(e.currentTarget);
          }}
        >
          {children}
        </button>
      </Tooltip>
    ) : (
      <span className={className}>{children}</span>
    );

  const assignment = thread.assignment;
  const assigneeName = assignment ? (assignment.userName ?? assignment.userEmail) : "";
  // The picker is only reachable when the parent wired a handler. An existing
  // assignment chip is always shown; the "assign" affordance for an unassigned
  // thread appears only when canAssign (workspace has ≥2 members).
  const assignInteractive = !!onOpenAssign;

  const classes = [
    "em-thread-row",
    thread.unread ? "unread" : "",
    selected ? "selected" : "",
    isDone ? "done" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      role="listitem"
    >
      <div className="em-thread-main">
        <div className="em-thread-top">
          <span className="em-thread-from">{thread.participants}</span>
          {thread.messageCount > 1 && (
            <span className="em-msg-count">{thread.messageCount}</span>
          )}
        </div>
        <div className="em-thread-subject">{thread.subject}</div>
        {thread.snippet && (
          <div className="em-thread-snippet">{thread.snippet}</div>
        )}
        <div className="em-thread-meta-row">
          {isDone && (
            <span className="em-pill em-pill--done">
              {CHECK_ICO}
              <Trans>Done</Trans>
            </span>
          )}
          {assignment && (
            assignInteractive ? (
              <button
                type="button"
                className="em-pill em-pill--assignee"
                aria-label={i18n._(msg`Assigned to ${assigneeName}. Change assignee`)}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAssign?.(e.currentTarget);
                }}
              >
                {PERSON_ICO}
                {assigneeName}
              </button>
            ) : (
              <span className="em-pill em-pill--assignee">
                {PERSON_ICO}
                {assigneeName}
              </span>
            )
          )}
          {isClassifying ? (
            <span className="em-route-chip sorting">
              <span className="em-chip-spin" aria-hidden />
              <Trans>Sorting…</Trans>
            </span>
          ) : thread.status === "unrouted" || thread.status === "unsorted" ? (
            <span className="em-route-chip unrouted">
              <Trans>Waiting</Trans>
            </span>
          ) : thread.status === "unclassified" ? (
            moveChip(
              "em-route-chip needs-review",
              i18n._(msg`Unclassified. Change folder`),
              <Trans>Unclassified</Trans>,
            )
          ) : (
            folder &&
            moveChip(
              chipClass,
              i18n._(msg`${chipLabel}. Change folder`),
              <>
                <span className="em-chip-ico">{FOLDER_ICO}</span>
                {chipLabel}
              </>,
            )
          )}
          {!isDone &&
            (() => {
              const lastIsOwn =
                !!workspaceEmail &&
                !!thread.lastSenderEmail &&
                thread.lastSenderEmail.toLowerCase() ===
                  workspaceEmail.toLowerCase();
              if (thread.isDrafting && !lastIsOwn)
                return (
                  <span className="em-pill">
                    <Trans>Drafting…</Trans>
                  </span>
                );
              if (thread.hasDraft && !lastIsOwn)
                return (
                  <span className="em-pill accent">
                    <Trans>draft</Trans>
                  </span>
                );
              return null;
            })()}
          {thread.attachmentCount > 0 && (
            <span className="em-attach-indicator">
              {CLIP_ICO}
              {thread.attachmentCount}
            </span>
          )}
        </div>
      </div>

      <div className="em-thread-side">
        <div className="em-thread-time" suppressHydrationWarning>
          {fmtTime(thread.latestAt, today)}
        </div>
        <div className="em-thread-actions">
          <Tooltip content={openInGmailLabel}>
            {onOpenInGmail ? (
              <button
                type="button"
                className="em-thread-gmail-link"
                aria-label={openInGmailLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInGmail();
                }}
              >
                {providerIcon}
              </button>
            ) : (
              <a
                href={buildThreadUrl(thread, workspaceEmail)}
                target="_blank"
                rel="noopener noreferrer"
                className="em-thread-gmail-link"
                aria-label={openInGmailLabel}
                onClick={(e) => e.stopPropagation()}
              >
                {providerIcon}
              </a>
            )}
          </Tooltip>
          {assignInteractive && (canAssign || assignment) && (
            <Tooltip
              content={
                assignment
                  ? i18n._(msg`Change assignee`)
                  : i18n._(msg`Assign to a member`)
              }
            >
              <button
                type="button"
                className={`em-assign-row-btn${assignment ? " is-assigned" : ""}`}
                aria-label={
                  assignment
                    ? i18n._(msg`Assigned to ${assigneeName}. Change assignee`)
                    : i18n._(msg`Assign to a member`)
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAssign?.(e.currentTarget);
                }}
              >
                {PERSON_ICO}
              </button>
            </Tooltip>
          )}
          <Tooltip content={markDoneLabel}>
            <button
              type="button"
              className={`em-done-btn${isDone ? " is-done" : ""}`}
              aria-label={markDoneLabel}
              aria-pressed={isDone}
              onClick={(e) => {
                e.stopPropagation();
                isDone ? onUnmarkDone() : onMarkDone();
              }}
            >
              {CHECK_ICO}
            </button>
          </Tooltip>
          {/* Trailing slot: a starred thread shows the star flush to the row's
              right edge (anchored, not floating) even when the other hover-only
              actions are hidden. */}
          <Tooltip content={importantLabel}>
            <button
              type="button"
              className={`em-star-btn${thread.isImportant ? " is-important" : ""}`}
              aria-label={importantLabel}
              aria-pressed={thread.isImportant}
              onClick={(e) => {
                e.stopPropagation();
                onToggleImportant();
              }}
            >
              <StarIco filled={thread.isImportant} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
