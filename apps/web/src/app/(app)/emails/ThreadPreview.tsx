"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Draft } from "@/lib/api";
import type { FolderItem, ThreadItem } from "./selection";
import { RationaleCard } from "./RationaleCard";
import { MessageCard } from "./MessageCard";
import { SuggestedDraftCard } from "./SuggestedDraftCard";

type DraftState = "idle" | "loading" | "ready" | "error";

type Props = {
  thread: ThreadItem;
  folders: FolderItem[];
  workspaceId: string;
  workspaceEmail: string | null;
  onApprove: (threadId: string) => void;
  onReroute: (threadId: string, anchor: HTMLElement) => void;
  onClose: () => void;
  onDraftStarted: (threadId: string) => void;
  onDraftFailed: (threadId: string) => void;
  onDraftGenerated: (threadId: string) => void;
  onDraftSentToggled: (threadId: string, sent: boolean) => void;
  onMarkDone: (threadId: string) => void;
  onUnmarkDone: (threadId: string) => void;
};

export function ThreadPreview({
  thread,
  folders,
  workspaceId,
  workspaceEmail,
  onApprove,
  onReroute,
  onClose,
  onDraftStarted,
  onDraftFailed,
  onDraftGenerated,
  onDraftSentToggled,
  onMarkDone,
  onUnmarkDone,
}: Props) {
  const [reasoning, setReasoning] = useState<string | null>(thread.reasoning);
  const [decisionSource, setDecisionSource] = useState<string | null>(null);
  const [_bodyLoaded, setBodyLoaded] = useState(false);
  const [messages, setMessages] = useState(thread.messages);

  const [draftState, setDraftState] = useState<DraftState>(
    thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle"
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPoll(threadId: string) {
    pollRef.current = setInterval(() => {
      api.threadDrafts(workspaceId, threadId).then(({ drafts: polled }) => {
        const d = polled[0];
        if (d?.status === "GENERATING") return; // still in progress
        clearPoll();
        if (d?.status === "PROPOSED") {
          setDraft(d);
          setDraftState("ready");
          onDraftGenerated(threadId);
        } else {
          // Empty result means generation failed or was never started
          setDraftState("error");
          onDraftFailed(threadId);
        }
      }).catch(() => {
        clearPoll();
        setDraftState("error");
        onDraftFailed(threadId);
      });
    }, 2_000);
  }

  useEffect(() => {
    setBodyLoaded(false);
    setDraftState(thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle");
    setDraft(null);
    clearPoll();

    api.emailThread(workspaceId, thread.id).then((detail) => {
      setReasoning(detail.latestClassification?.explanation ?? null);
      setDecisionSource(detail.latestClassification?.decisionSource ?? null);
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          fromName: m.senderName ?? m.senderEmail,
          fromEmail: m.senderEmail,
          time: new Date(m.receivedAt),
          snippet: m.snippet,
          bodyText: m.bodyText,
        }))
      );
      setBodyLoaded(true);
    }).catch(() => {
      setBodyLoaded(true);
    });

    if (thread.status !== "unsorted") {
      api.threadDrafts(workspaceId, thread.id).then(({ drafts }) => {
        const latest = drafts[0];
        if (latest?.status === "GENERATING" || (!latest && thread.isDrafting)) {
          setDraftState("loading");
          startPoll(thread.id);
        } else if (latest?.status === "PROPOSED" || latest?.status === "SENT") {
          setDraft(latest);
          setDraftState("ready");
        }
        // !latest && !isDrafting → draftState already set to "idle" above
      }).catch(() => {});
    }

    return clearPoll;
  }, [thread.id, workspaceId]);

  function handleGenerateDraft() {
    const threadId = thread.id;
    setDraftState("loading");
    onDraftStarted(threadId);
    api.generateDraft(workspaceId, threadId).then((result) => {
      if ("generating" in result) {
        // Server says generation is already in progress (e.g. duplicate click);
        // poll until the draft resolves.
        startPoll(threadId);
        return;
      }
      setDraft(result.draft);
      setDraftState("ready");
      onDraftGenerated(threadId);
    }).catch(() => {
      setDraftState("error");
      onDraftFailed(threadId);
    });
  }

  function handleToggleDraftSent() {
    if (!draft) return;
    const newSent = draft.status !== "SENT";
    const optimistic = { ...draft, status: newSent ? "SENT" : "PROPOSED" };
    setDraft(optimistic);
    onDraftSentToggled(thread.id, newSent);
    api.toggleDraftSent(workspaceId, thread.id, draft.id, newSent)
      .then(({ draft: updated }) => setDraft(updated))
      .catch(() => {
        setDraft(draft);
        onDraftSentToggled(thread.id, !newSent);
      });
  }

  const enrichedThread = { ...thread, reasoning };
  const lastMsg = messages[messages.length - 1];
  const lastMsgIsOwn =
    !!workspaceEmail &&
    !!lastMsg?.fromEmail &&
    lastMsg.fromEmail.toLowerCase() === workspaceEmail.toLowerCase();
  const canDraft = thread.status !== "unsorted" && !lastMsgIsOwn;

  return (
    <div className="em-preview-col">
      <div className="em-preview-toolbar">
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
        <span className="em-preview-spacer" />
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

        <RationaleCard
          thread={enrichedThread}
          folders={folders}
          decisionSource={decisionSource}
          onApprove={() => onApprove(thread.id)}
          onReroute={(anchor) => onReroute(thread.id, anchor)}
          onMarkDone={() => onMarkDone(thread.id)}
          onUnmarkDone={() => onUnmarkDone(thread.id)}
        />

        <div className="em-msg-list">
          {messages.map((msg, i) => (
            <MessageCard
              key={msg.id}
              message={msg}
              defaultExpanded={i === messages.length - 1}
            />
          ))}
        </div>

        {canDraft && draftState === "idle" && (
          <button
            type="button"
            className="em-draft-cta"
            onClick={handleGenerateDraft}
          >
            <span className="em-draft-cta-glyph" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 9.5h8M2 7l5-5 1.5 1.5-5 5H2V7zM7 3l1.5-1.5 1.5 1.5-1.5 1.5L7 3z"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Generate draft reply
          </button>
        )}

        {draftState === "loading" && (
          <div className="em-draft-skeleton">
            <span className="em-draft-skeleton-pulse" />
            Writing draft reply…
          </div>
        )}

        {draftState === "error" && (
          <div className="em-draft-error">
            <span>Draft generation failed. Try again.</span>
            <button
              type="button"
              className="em-btn ghost"
              onClick={handleGenerateDraft}
            >
              Retry
            </button>
          </div>
        )}

        {canDraft && draftState === "ready" && draft && (
          <SuggestedDraftCard draft={draft} onToggleSent={handleToggleDraftSent} />
        )}
      </div>
    </div>
  );
}
