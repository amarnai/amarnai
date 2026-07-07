"use client";

import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { api } from "@/lib/api";
import type { Draft } from "@/lib/api";
import type { FolderItem, ThreadItem, MemberItem } from "@amarnai/ui/emails";
import { RationaleCard, MessageCard, SuggestedDraftCard, TriageBar, buildThreadUrl } from "@amarnai/ui/emails";
import { Tooltip } from "@amarnai/ui";
import { formatQuotaResetDate } from "@amarnai/shared";

type DraftState = "idle" | "loading" | "ready" | "error";

type Props = {
  thread: ThreadItem;
  folders: FolderItem[];
  workspaceId: string;
  workspaceEmail: string | null;
  routableNodeCount: number;
  onApprove: (threadId: string) => void;
  onReroute: (threadId: string, anchor: HTMLElement) => void;
  onClose: () => void;
  onDraftStarted: (threadId: string) => void;
  onDraftFailed: (threadId: string) => void;
  onDraftGenerated: (threadId: string) => void;
  onDraftSentToggled: (threadId: string, sent: boolean) => void;
  onMarkDone: (threadId: string) => void;
  onUnmarkDone: (threadId: string) => void;
  onToggleImportant: (threadId: string) => void;
  members: MemberItem[];
  canAssign: boolean;
  onOpenAssign: (threadId: string, anchor: HTMLElement) => void;
};

export function ThreadPreview({
  thread,
  folders,
  workspaceId,
  workspaceEmail,
  routableNodeCount,
  onApprove,
  onReroute,
  onClose,
  onDraftStarted,
  onDraftFailed,
  onDraftGenerated,
  onDraftSentToggled,
  onMarkDone,
  onUnmarkDone,
  onToggleImportant,
  members,
  canAssign,
  onOpenAssign,
}: Props) {
  const { _ } = useLingui();
  const [reasoning, setReasoning] = useState<string | null>(thread.reasoning);
  const [decisionSource, setDecisionSource] = useState<string | null>(null);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [messages, setMessages] = useState(thread.messages);

  const [draftState, setDraftState] = useState<DraftState>(
    thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle"
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftQuota, setDraftQuota] = useState<{ used: number; limit: number; resetsAt: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bodiesRef = useRef<Record<string, string | null> | null>(null);

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
    bodiesRef.current = null;
    setMessages(thread.messages);
    setReasoning(null);
    setDecisionSource(null);
    setDraftState(thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle");
    setDraft(null);
    clearPoll();

    // Fire both calls simultaneously. emailThread resolves first (DB-only, fast)
    // and renders metadata. threadBodies resolves later (Gmail fetch) and fills
    // in body text. bodiesRef guards against the race where threadBodies wins.

    api.emailThread(workspaceId, thread.id).then((detail) => {
      setReasoning(detail.latestClassification?.explanation ?? null);
      setDecisionSource(detail.latestClassification?.decisionSource ?? null);
      const bodies = bodiesRef.current;
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          fromName: m.senderName ?? m.senderEmail,
          fromEmail: m.senderEmail,
          time: new Date(m.receivedAt),
          snippet: m.snippet,
          bodyText: (bodies !== null && m.id in bodies ? bodies[m.id] : null) ?? m.bodyText,
          attachments: m.attachments,
        }))
      );
    }).catch(() => {});

    api.threadBodies(workspaceId, thread.id).then(({ bodies }) => {
      bodiesRef.current = bodies;
      setMessages((prev) => prev.map((m) => (m.id in bodies ? { ...m, bodyText: bodies[m.id] ?? null } : m)));
      setBodyLoaded(true);
    }).catch(() => {
      setBodyLoaded(true);
    });

    if (thread.status !== "unsorted") {
      api.draftQuota(workspaceId).then(setDraftQuota).catch(() => {});

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

  function handleGenerateDraft(opts: { force?: boolean } = {}) {
    const threadId = thread.id;
    setDraftState("loading");
    onDraftStarted(threadId);
    api.generateDraft(workspaceId, threadId, opts).then((result) => {
      if ("generating" in result) {
        // Server says generation is already in progress (e.g. duplicate click);
        // poll until the draft resolves.
        startPoll(threadId);
        return;
      }
      if ("quotaExceeded" in result) {
        setDraftState(opts.force ? "ready" : "idle");
        setDraftQuota({ used: result.used, limit: result.limit, resetsAt: result.resetsAt });
        onDraftFailed(threadId);
        return;
      }
      setDraft(result.draft);
      setDraftState("ready");
      if (result.isNew) {
        setDraftQuota((q) => q ? { ...q, used: q.used + 1 } : q);
      }
      onDraftGenerated(threadId);
    }).catch(() => {
      setDraftState("error");
      onDraftFailed(threadId);
    });
  }

  function handleRegenerateDraft() {
    handleGenerateDraft({ force: true });
  }

  function handleToggleDraftSent() {
    if (!draft) return;
    const newSent = draft.status !== "SENT";
    const optimistic: Draft = { ...draft, status: newSent ? "SENT" : "PROPOSED" };
    setDraft(optimistic);
    onDraftSentToggled(thread.id, newSent);
    api.toggleDraftSent(workspaceId, thread.id, draft.id, newSent)
      .then(({ draft: updated }) => setDraft(updated))
      .catch(() => {
        setDraft(draft);
        onDraftSentToggled(thread.id, !newSent);
      });
  }

  const isDone = !!thread.doneMark;
  const enrichedThread = { ...thread, reasoning };
  const lastMsg = messages[messages.length - 1];
  const lastMsgIsOwn =
    !!workspaceEmail &&
    !!lastMsg?.fromEmail &&
    lastMsg.fromEmail.toLowerCase() === workspaceEmail.toLowerCase();
  const canDraft = thread.status !== "unsorted" && !lastMsgIsOwn;
  const quotaExhausted = draftQuota !== null && draftQuota.used >= draftQuota.limit;
  const quotaResetDate = draftQuota ? formatQuotaResetDate(draftQuota.resetsAt) : null;
  const quotaRemaining = draftQuota ? draftQuota.limit - draftQuota.used : 0;

  return (
    <div className="em-preview-col">
      <div className="em-preview-toolbar">
        <button
          type="button"
          className="em-back-btn"
          onClick={onClose}
          aria-label={_(msg`Back to list`)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Trans>Back</Trans>
        </button>
        <span className="em-preview-spacer" />
        <Tooltip
          content={thread.isImportant ? _(msg`Remove from important`) : _(msg`Mark as important`)}
          placement="bottom"
        >
          <button
            type="button"
            className={`em-icon-btn em-star-btn${thread.isImportant ? " is-important" : ""}`}
            aria-label={thread.isImportant ? _(msg`Remove from important`) : _(msg`Mark as important`)}
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
        <Tooltip content={_(msg`Close preview`)} placement="left">
          <button
            type="button"
            className="em-icon-btn"
            aria-label={_(msg`Close preview`)}
            onClick={onClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div className="em-preview-scroll">
        <h2 className="em-preview-subject">
          {thread.subject}
          <Tooltip
            content={
              thread.provider === "OUTLOOK" ? _(msg`Open in Outlook`) : _(msg`Open in Gmail`)
            }
            placement="bottom"
          >
            <a
              href={buildThreadUrl(thread)}
              target="_blank"
              rel="noopener noreferrer"
              className="em-preview-gmail-link"
              aria-label={
                thread.provider === "OUTLOOK" ? _(msg`Open in Outlook`) : _(msg`Open in Gmail`)
              }
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7.5 1H11v3.5M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </Tooltip>
        </h2>

        <TriageBar
          isDone={isDone}
          doneMark={thread.doneMark}
          onMark={() => onMarkDone(thread.id)}
          onUnmark={() => onUnmarkDone(thread.id)}
          assignment={thread.assignment}
          canAssign={canAssign}
          {...(members.length > 0
            ? { onOpenAssign: (anchor: HTMLElement) => onOpenAssign(thread.id, anchor) }
            : {})}
        />

        <RationaleCard
          thread={enrichedThread}
          folders={folders}
          decisionSource={decisionSource}
          routableNodeCount={routableNodeCount}
          onApprove={() => onApprove(thread.id)}
          onReroute={(anchor) => onReroute(thread.id, anchor)}
        />

        <div className="em-msg-list">
          {messages.map((msg, idx) => (
            <MessageCard
              key={msg.id}
              message={msg}
              defaultExpanded={idx === messages.length - 1}
              loading={!bodyLoaded}
            />
          ))}
        </div>

        {canDraft && draftState === "idle" && (
          <div className="em-draft-cta-wrap">
            <button
              type="button"
              className="em-draft-cta"
              onClick={() => handleGenerateDraft()}
              disabled={quotaExhausted}
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
              <Trans>Generate draft reply</Trans>
            </button>
            {draftQuota !== null && (
              <p className={`em-draft-quota${quotaExhausted ? " em-draft-quota--exhausted" : ""}`}>
                {quotaExhausted
                  ? <Trans>No drafts remaining · resets {quotaResetDate}</Trans>
                  : <Trans>{quotaRemaining} of {draftQuota.limit} remaining · resets {quotaResetDate}</Trans>
                }
              </p>
            )}
          </div>
        )}

        {draftState === "loading" && (
          <div className="em-draft-skeleton">
            <span className="em-draft-skeleton-pulse" />
            <Trans>Writing draft reply…</Trans>
          </div>
        )}

        {draftState === "error" && (
          <div className="em-draft-error">
            <span><Trans>Draft generation failed. Try again.</Trans></span>
            <button
              type="button"
              className="em-btn ghost"
              onClick={() => handleGenerateDraft()}
            >
              <Trans>Retry</Trans>
            </button>
          </div>
        )}

        {canDraft && draftState === "ready" && draft && (
          <SuggestedDraftCard
            draft={draft}
            onToggleSent={handleToggleDraftSent}
            onRegenerate={handleRegenerateDraft}
            quota={draftQuota}
          />
        )}
      </div>
    </div>
  );
}
