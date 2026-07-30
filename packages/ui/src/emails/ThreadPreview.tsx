"use client";

import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ThreadItem, ThreadMessage, DraftItem } from "./types.js";
import { buildThreadUrl } from "@amarnai/core/emails";
import { openInProviderLabel } from "./providerLabels.js";
import { GmailIcon } from "../icons/GmailIcon.js";
import { OutlookIcon } from "../icons/OutlookIcon.js";
import { PreviewDoneBar } from "./PreviewDoneBar.js";
import { MessageCard } from "./MessageCard.js";
import { SuggestedDraftCard } from "./SuggestedDraftCard.js";
import { ThreadSummaryCard } from "./ThreadSummaryCard.js";
import { Tooltip } from "../Tooltip.js";

export interface ThreadPreviewProps {
  thread: ThreadItem;
  /** Full message list — provided statically (no fetching). */
  messages: ThreadMessage[];
  /** Current draft — controlled by the parent. */
  draft?: DraftItem | null | undefined;
  workspaceEmail?: string | null | undefined;
  /** Called when the user clicks "Generate draft reply". Should resolve when the draft is ready. */
  onGenerateDraft?: (() => Promise<void>) | undefined;
  /** Called when the user toggles the sent status of the draft. */
  onToggleDraftSent?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  onMarkDone?: ((threadId: string) => void) | undefined;
  onUnmarkDone?: ((threadId: string) => void) | undefined;
  onToggleImportant?: ((threadId: string) => void) | undefined;
  /**
   * Which surface this preview mimics. "extension" matches the browser side
   * panel (a full-width "Open in <provider>" button below the toolbar and a star
   * toggle in it); "web" (default) matches the web app (a compact deep-link
   * glyph beside the subject).
   */
  surface?: "web" | "extension";
  /**
   * When provided, the "Open in <provider>" control calls this instead of
   * navigating to the real provider deep link (used by the marketing demo to
   * open a mock provider view).
   */
  onOpenInProvider?: ((thread: ThreadItem) => void) | undefined;
  /**
   * Canned TL;DR for the demo. The real app generates this lazily against the
   * API; here it is passed in statically so marketing screenshots show the slot
   * filled. Omit to hide the card.
   */
  summary?: string | undefined;
  /** Canned bulleted TL;DR for the demo; takes precedence over `summary`. */
  summaryBullets?: string[] | undefined;
  /** True when the workspace has ≥2 members, so assigning is on offer at all. */
  canAssign?: boolean | undefined;
  /** Opens the assignee picker anchored on the control that was clicked. */
  onOpenAssign?: ((threadId: string, anchor: HTMLElement) => void) | undefined;
}

export function ThreadPreview({
  thread,
  messages,
  draft = null,
  workspaceEmail,
  onGenerateDraft,
  onToggleDraftSent,
  onClose,
  onMarkDone,
  onUnmarkDone,
  onToggleImportant,
  surface = "web",
  onOpenInProvider,
  summary,
  summaryBullets,
  canAssign,
  onOpenAssign,
}: ThreadPreviewProps) {
  const { i18n } = useLingui();
  const [generating, setGenerating] = useState(false);

  const isExtension = surface === "extension";
  const assigneeName = thread.assignment
    ? (thread.assignment.userName ?? thread.assignment.userEmail)
    : "";
  const providerLabel = openInProviderLabel(i18n, thread.provider);
  const providerIcon =
    thread.provider === "OUTLOOK" ? (
      <OutlookIcon variant="color" size={16} />
    ) : (
      <GmailIcon variant="color" size={16} />
    );
  const isDone = !!thread.doneMark;
  const lastMsg = messages[messages.length - 1];
  const lastMsgIsOwn =
    !!workspaceEmail &&
    !!lastMsg?.fromEmail &&
    lastMsg.fromEmail.toLowerCase() === workspaceEmail.toLowerCase();
  const canDraft = thread.status !== "unsorted" && !lastMsgIsOwn;

  async function handleGenerateDraft() {
    if (!onGenerateDraft) return;
    setGenerating(true);
    try {
      await onGenerateDraft();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="em-preview-col">
      <div className="em-preview-toolbar">
        {onClose && (
          <button
            type="button"
            className="em-back-btn"
            onClick={onClose}
            aria-label={i18n._(msg`Back to list`)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <Trans>Back</Trans>
          </button>
        )}
        <span className="em-preview-spacer" />
        {isExtension && onToggleImportant ? (
          <Tooltip content={thread.isImportant ? i18n._(msg`Remove from important`) : i18n._(msg`Mark as important`)}>
            <button
              type="button"
              className={`em-icon-btn em-star-btn${thread.isImportant ? " is-important" : ""}`}
              aria-label={thread.isImportant ? i18n._(msg`Remove from important`) : i18n._(msg`Mark as important`)}
              aria-pressed={thread.isImportant}
              onClick={() => onToggleImportant(thread.id)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M7 1.75l1.545 3.13 3.455.502-2.5 2.437.59 3.44L7 9.63l-3.09 1.625.59-3.44-2.5-2.437 3.455-.502z"
                  fill={thread.isImportant ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={thread.isImportant ? 0 : 1.3}
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </Tooltip>
        ) : (
          onClose && (
            <Tooltip content={i18n._(msg`Close preview`)}>
              <button
                type="button"
                className="em-icon-btn"
                aria-label={i18n._(msg`Close preview`)}
                onClick={onClose}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </Tooltip>
          )
        )}
      </div>

      {isExtension && (
        <div className="em-open-provider-row">
          {onOpenInProvider ? (
            <button
              type="button"
              className="em-open-provider"
              onClick={() => onOpenInProvider(thread)}
            >
              {providerIcon}
              {providerLabel}
            </button>
          ) : (
            <a
              href={buildThreadUrl(thread, workspaceEmail)}
              target="_blank"
              rel="noopener noreferrer"
              className="em-open-provider"
            >
              {providerIcon}
              {providerLabel}
            </a>
          )}
        </div>
      )}

      <div className="em-preview-scroll">
        <h2 className="em-preview-subject">
          {thread.subject}
          {!isExtension && (
            <Tooltip content={providerLabel} placement="bottom">
              {onOpenInProvider ? (
                <button
                  type="button"
                  className="em-preview-gmail-link"
                  aria-label={providerLabel}
                  onClick={() => onOpenInProvider(thread)}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7.5 1H11v3.5M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <a
                  href={buildThreadUrl(thread, workspaceEmail)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="em-preview-gmail-link"
                  aria-label={providerLabel}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7.5 1H11v3.5M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </Tooltip>
          )}
        </h2>

        {/* Done and assignee share a row: both answer "who has this and is it
            finished", and in the 360px panel they cannot each have a line. */}
        {((onMarkDone || onUnmarkDone) || (onOpenAssign && (canAssign || thread.assignment))) && (
          <div className="em-preview-state-row">
            {(onMarkDone || onUnmarkDone) && (
              <PreviewDoneBar
                isDone={isDone}
                doneMark={thread.doneMark}
                onMark={() => onMarkDone?.(thread.id)}
                onUnmark={() => onUnmarkDone?.(thread.id)}
                showDoneBy={false}
              />
            )}
            {onOpenAssign && (canAssign || thread.assignment) && (
              <button
                type="button"
                className={`em-preview-assign${thread.assignment ? " is-assigned" : ""}`}
                aria-label={
                  thread.assignment
                    ? i18n._(msg`Assigned to ${assigneeName}. Change assignee`)
                    : i18n._(msg`Assign to a member`)
                }
                onClick={(e) => onOpenAssign(thread.id, e.currentTarget)}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <circle cx="6" cy="4" r="2.1" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M1.9 10.4c0-2 1.8-3.3 4.1-3.3s4.1 1.3 4.1 3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {thread.assignment ? assigneeName : <Trans>Assign</Trans>}
              </button>
            )}
          </div>
        )}

        {summaryBullets && summaryBullets.length > 0 ? (
          <ThreadSummaryCard state={{ kind: "bullets", bullets: summaryBullets }} />
        ) : summary ? (
          <ThreadSummaryCard state={{ kind: "summary", text: summary }} />
        ) : null}

        <div className="em-msg-list">
          {messages.map((msg, i) => (
            <MessageCard key={msg.id} message={msg} defaultExpanded={i === messages.length - 1} />
          ))}
        </div>

        {canDraft && !draft && !generating && (
          <button type="button" className="em-draft-cta" onClick={handleGenerateDraft}>
            <span className="em-draft-cta-glyph" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 9.5h8M2 7l5-5 1.5 1.5-5 5H2V7zM7 3l1.5-1.5 1.5 1.5-1.5 1.5L7 3z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <Trans>Generate draft reply</Trans>
          </button>
        )}

        {generating && (
          <div className="em-draft-skeleton">
            <span className="em-draft-skeleton-pulse" />
            <Trans>Writing draft reply…</Trans>
          </div>
        )}

        {draft && !generating && (
          <SuggestedDraftCard draft={draft} onToggleSent={() => onToggleDraftSent?.()} />
        )}
      </div>
    </div>
  );
}
