"use client";

import { useState } from "react";
import type { FolderItem } from "../folder-tree/types.js";
import type { ThreadItem, ThreadMessage, DraftItem } from "./types.js";
import { RationaleCard } from "./RationaleCard.js";
import { PreviewDoneBar } from "./PreviewDoneBar.js";
import { MessageCard } from "./MessageCard.js";
import { SuggestedDraftCard } from "./SuggestedDraftCard.js";

export interface ThreadPreviewProps {
  thread: ThreadItem;
  folders: FolderItem[];
  /** Full message list — provided statically (no fetching). */
  messages: ThreadMessage[];
  /** AI reasoning text — provided statically. */
  reasoning: string | null;
  decisionSource?: string | null;
  /** Current draft — controlled by the parent. */
  draft?: DraftItem | null | undefined;
  workspaceEmail?: string | null | undefined;
  /** Called when the user clicks "Generate draft reply". Should resolve when the draft is ready. */
  onGenerateDraft?: (() => Promise<void>) | undefined;
  /** Called when the user toggles the sent status of the draft. */
  onToggleDraftSent?: (() => void) | undefined;
  onApprove?: ((threadId: string) => void) | undefined;
  onReroute?: ((threadId: string, anchor: HTMLElement) => void) | undefined;
  onClose?: (() => void) | undefined;
  onMarkDone?: ((threadId: string) => void) | undefined;
  onUnmarkDone?: ((threadId: string) => void) | undefined;
}

export function ThreadPreview({
  thread,
  folders,
  messages,
  reasoning,
  decisionSource = null,
  draft = null,
  workspaceEmail,
  onGenerateDraft,
  onToggleDraftSent,
  onApprove,
  onReroute,
  onClose,
  onMarkDone,
  onUnmarkDone,
}: ThreadPreviewProps) {
  const [generating, setGenerating] = useState(false);

  const isDone = !!thread.doneMark;
  const enrichedThread = { ...thread, reasoning };
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
            aria-label="Back to list"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
        )}
        <span className="em-preview-spacer" />
        {onClose && (
          <button
            type="button"
            className="em-icon-btn"
            title="Close preview"
            aria-label="Close preview"
            onClick={onClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="em-preview-scroll">
        <h2 className="em-preview-subject">
          {thread.subject}
          <a
            href={`https://mail.google.com/mail/u/0/#all/${thread.providerThreadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="em-preview-gmail-link"
            title="Open in Gmail"
            aria-label="Open in Gmail"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7.5 1H11v3.5M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </h2>

        {(onMarkDone || onUnmarkDone) && (
          <PreviewDoneBar
            isDone={isDone}
            doneMark={thread.doneMark}
            onMark={() => onMarkDone?.(thread.id)}
            onUnmark={() => onUnmarkDone?.(thread.id)}
          />
        )}

        <RationaleCard
          thread={enrichedThread}
          folders={folders}
          decisionSource={decisionSource}
          onApprove={onApprove ? () => onApprove(thread.id) : undefined}
          onReroute={onReroute ? (anchor) => onReroute(thread.id, anchor) : undefined}
        />

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
            Generate draft reply
          </button>
        )}

        {generating && (
          <div className="em-draft-skeleton">
            <span className="em-draft-skeleton-pulse" />
            Writing draft reply…
          </div>
        )}

        {draft && !generating && (
          <SuggestedDraftCard draft={draft} onToggleSent={() => onToggleDraftSent?.()} />
        )}
      </div>
    </div>
  );
}
