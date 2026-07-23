import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, Draft } from "@amarnai/api-client";
import type { FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { RationaleCard, MessageCard, SuggestedDraftCard, TriageBar } from "@amarnai/ui/emails";
import { GmailIcon, OutlookIcon } from "@amarnai/ui";
import { formatQuotaResetDate, TAXONOMY_MIN_NON_ROOT_NODES } from "@amarnai/shared";
import { openThreadInMail } from "../gmail/openInGmail";
import { WEB_APP_URL } from "../config";

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
  canAssign: boolean;
  onOpenAssign: (threadId: string, anchor: HTMLElement) => void;
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
  canAssign,
  onOpenAssign,
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
  // Resolved blob: URLs for CID inline images, keyed by DB message id. The
  // extension's Bearer transport cannot authenticate a plain <img src>, so the
  // bytes are fetched and turned into object URLs. Held in a ref (like bodiesRef)
  // so a late emailThread rebuild re-attaches them instead of dropping them.
  const inlineImagesRef = useRef<Record<string, Array<{ url: string; filename: string | null }>>>({});
  // Every object URL created for this thread, revoked on thread change/unmount.
  const objectUrlsRef = useRef<string[]>([]);

  function revokeObjectUrls() {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current = [];
    inlineImagesRef.current = {};
  }

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
    let cancelled = false;
    setBodyLoaded(false);
    bodiesRef.current = null;
    setMessages(thread.messages);
    setReasoning(null);
    setDecisionSource(null);
    setDraftState(thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle");
    setDraft(null);
    clearPoll();

    // Fetch each CID inline image as a blob and turn it into an object URL (the
    // Bearer transport can't authenticate a plain <img src>). Merges the urls in
    // as they resolve; inlineImagesRef lets a late emailThread rebuild keep them.
    async function loadInlineImages(
      descriptorsByMsg: Record<
        string,
        Array<{ attachmentId: string; mimeType: string; filename: string | null }>
      >,
    ) {
      for (const [messageId, descriptors] of Object.entries(descriptorsByMsg)) {
        const resolved: Array<{ url: string; filename: string | null }> = [];
        for (const d of descriptors) {
          const blob = await api.fetchInlineImage(workspaceId, thread.id, messageId, d.attachmentId);
          if (cancelled) return;
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          resolved.push({ url, filename: d.filename });
        }
        if (cancelled) return;
        if (resolved.length > 0) {
          inlineImagesRef.current[messageId] = resolved;
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, inlineImages: resolved } : m)),
          );
        }
      }
    }

    // Fire both calls at once. emailThread resolves first (DB-only) and renders
    // metadata; threadBodies resolves later (Gmail fetch) and fills body text.
    // bodiesRef guards the race where threadBodies wins.
    api.emailThread(workspaceId, thread.id).then((detail) => {
      setReasoning(detail.latestClassification?.explanation ?? null);
      setDecisionSource(detail.latestClassification?.decisionSource ?? null);
      const bodies = bodiesRef.current;
      setMessages(
        detail.messages.map((m) => {
          const imgs = inlineImagesRef.current[m.id];
          return {
            id: m.id,
            fromName: m.senderName ?? m.senderEmail,
            fromEmail: m.senderEmail,
            time: new Date(m.receivedAt),
            snippet: m.snippet,
            bodyText: (bodies !== null && m.id in bodies ? bodies[m.id] : null) ?? m.bodyText,
            attachments: m.attachments,
            ...(imgs ? { inlineImages: imgs } : {}),
          };
        }),
      );
    }).catch(() => {});

    api.threadBodies(workspaceId, thread.id).then(({ bodies, inlineImages }) => {
      bodiesRef.current = bodies;
      setMessages((prev) => prev.map((m) => (m.id in bodies ? { ...m, bodyText: bodies[m.id] ?? null } : m)));
      setBodyLoaded(true);
      void loadInlineImages(inlineImages ?? {});
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

    return () => {
      cancelled = true;
      clearPoll();
      revokeObjectUrls();
    };
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
            onClick={() => void openThreadInMail(gmailAddress, thread)}
          >
            {thread.provider === "OUTLOOK" ? (
              <OutlookIcon variant="color" size={16} />
            ) : (
              <GmailIcon variant="color" size={16} />
            )}
            {thread.provider === "OUTLOOK" ? (
              <Trans>Open in Outlook</Trans>
            ) : (
              <Trans>Open in Gmail</Trans>
            )}
          </button>
        </div>
      )}

      <div className="em-preview-scroll">
        <h2 className="em-preview-subject">{thread.subject}</h2>

        <TriageBar
          isDone={isDone}
          doneMark={thread.doneMark}
          onMark={() => onMarkDone(thread.id)}
          onUnmark={() => onUnmarkDone(thread.id)}
          assignment={thread.assignment}
          canAssign={canAssign}
          onOpenAssign={(anchor) => onOpenAssign(thread.id, anchor)}
        />

        {isUnsorted ? (
          routableNodeCount < TAXONOMY_MIN_NON_ROOT_NODES ? (
            // Taxonomy too weak to route into (same threshold the web app uses to
            // gate "Route now"), so triage would no-op. Send the user to the web
            // app to build out their sorting plan first.
            <div className="ax-sort-now-wrap">
              <p><Trans>This thread hasn't been sorted yet. Create a sorting plan so Amarnai knows where to file it.</Trans></p>
              <a
                className="ax-btn ax-btn-secondary ax-sort-now"
                href={`${WEB_APP_URL}/plan`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Trans>Plan sorting</Trans>
              </a>
            </div>
          ) : (
            <div className="ax-sort-now-wrap">
              <p><Trans>This thread hasn't been sorted yet.</Trans></p>
            </div>
          )
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
