import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, Draft } from "@amarnai/api-client";
import type { FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { RationaleCard, MessageCard, SuggestedDraftCard, PreviewDoneBar } from "@amarnai/ui/emails";
import { formatQuotaResetDate } from "@amarnai/shared";
import { openInGmail } from "../gmail/openInGmail";
import { SortNowButton } from "./SortNowButton";

type DraftState = "idle" | "loading" | "ready" | "error";

type Props = {
  api: ApiClient;
  thread: ThreadItem;
  folders: FolderItem[];
  workspaceId: string;
  workspaceEmail: string | null;
  gmailAddress: string | null;
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
};

// Port of apps/web ThreadPreview, with the internal-secret api client swapped
// for the injected session client, the hardcoded Gmail anchor replaced by the
// openInGmail helper (correct account + tab reuse), and a Sort-now control for
// threads that have not been triaged yet.
export function ThreadPreviewPane({
  api,
  thread,
  folders,
  workspaceId,
  workspaceEmail,
  gmailAddress,
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
}: Props) {
  const { _ } = useLingui();
  const [reasoning, setReasoning] = useState<string | null>(thread.reasoning);
  const [decisionSource, setDecisionSource] = useState<string | null>(null);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [messages, setMessages] = useState(thread.messages);

  const [draftState, setDraftState] = useState<DraftState>(
    thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle",
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

    // Fire both calls at once. emailThread resolves first (DB-only) and renders
    // metadata; threadBodies resolves later (Gmail fetch) and fills body text.
    // bodiesRef guards the race where threadBodies wins.
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
        })),
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
        setDraftQuota((q) => (q ? { ...q, used: q.used + 1 } : q));
      }
      onDraftGenerated(threadId);
    }).catch(() => {
      setDraftState("error");
      onDraftFailed(threadId);
    });
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
  const isUnsorted = thread.status === "unsorted" || thread.status === "unrouted";
  const canDraft = thread.status !== "unsorted" && !lastMsgIsOwn;
  const quotaExhausted = draftQuota !== null && draftQuota.used >= draftQuota.limit;
  const quotaResetDate = draftQuota ? formatQuotaResetDate(draftQuota.resetsAt) : null;
  const quotaRemaining = draftQuota ? draftQuota.limit - draftQuota.used : 0;

  return (
    <div className="em-preview-col">
      <div className="em-preview-toolbar">
        <button type="button" className="em-back-btn" onClick={onClose} aria-label={_(msg`Back to list`)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Trans>Back</Trans>
        </button>
        <span className="em-preview-spacer" />
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
      </div>

      {gmailAddress && (
        <div className="ax-open-gmail-row">
          <button
            type="button"
            className="ax-btn ax-btn-secondary ax-open-gmail"
            onClick={() => void openInGmail(gmailAddress, thread.providerThreadId)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            <Trans>Open in Gmail</Trans>
          </button>
        </div>
      )}

      <div className="em-preview-scroll">
        <h2 className="em-preview-subject">{thread.subject}</h2>

        <PreviewDoneBar
          isDone={isDone}
          doneMark={thread.doneMark}
          onMark={() => onMarkDone(thread.id)}
          onUnmark={() => onUnmarkDone(thread.id)}
        />

        {isUnsorted ? (
          <div className="ax-sort-now-wrap">
            <p><Trans>This thread hasn't been sorted yet.</Trans></p>
            <SortNowButton api={api} workspaceId={workspaceId} threadId={thread.id} />
          </div>
        ) : (
          <RationaleCard
            thread={enrichedThread}
            folders={folders}
            decisionSource={decisionSource}
            routableNodeCount={routableNodeCount}
            onApprove={() => onApprove(thread.id)}
            onReroute={(anchor) => onReroute(thread.id, anchor)}
          />
        )}

        <div className="em-msg-list">
          {messages.map((m, idx) => (
            <MessageCard
              key={m.id}
              message={m}
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
              <Trans>Generate draft reply</Trans>
            </button>
            {draftQuota !== null && (
              <p className={`em-draft-quota${quotaExhausted ? " em-draft-quota--exhausted" : ""}`}>
                {quotaExhausted
                  ? <Trans>No drafts remaining · resets {quotaResetDate}</Trans>
                  : <Trans>{quotaRemaining} of {draftQuota.limit} remaining · resets {quotaResetDate}</Trans>}
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
            <button type="button" className="em-btn ghost" onClick={() => handleGenerateDraft()}>
              <Trans>Retry</Trans>
            </button>
          </div>
        )}

        {canDraft && draftState === "ready" && draft && (
          <SuggestedDraftCard
            draft={draft}
            onToggleSent={handleToggleDraftSent}
            onRegenerate={() => handleGenerateDraft({ force: true })}
            quota={draftQuota}
          />
        )}
      </div>
    </div>
  );
}
