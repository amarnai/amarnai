"use client";

import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { ApiClient } from "@aziru/api-client";
import { SuggestedDraftCard } from "@aziru/ui/emails";
import { draftBodyToHtml } from "@aziru/core/drafts";
import { formatQuotaResetDate } from "@aziru/shared";
import type { Draft, EmailThreadDetail, QuotaInfo } from "./types.js";

// Drafting a reply, from inside the mail client the reply will be sent from.
//
// The one thing this does that the web app cannot: hand the finished text to the
// mail client's own compose window, so the user reviews and sends it there. That
// is also the boundary — Amarnai composes, the mail client sends. There is no
// code path here that sends anything, in either host.

const POLL_INTERVAL_MS = 2_000;

type DraftState = "idle" | "loading" | "ready" | "error";

export type DraftSectionProps = {
  api: ApiClient;
  workspaceId: string;
  thread: EmailThreadDetail;
  /** The mailbox reading the thread, so we do not offer to reply to itself. */
  accountEmail: string;
  /** Generate on load, for entry points that already are the request. */
  autoDraft?: boolean;
  /** False when this host has no compose to insert into (copy still works). */
  canInsert: boolean;
  insertDraft: (html: string) => Promise<boolean>;
};

export function DraftSection({
  api,
  workspaceId,
  thread,
  accountEmail,
  autoDraft = false,
  canInsert,
  insertDraft,
}: DraftSectionProps) {
  const [state, setState] = useState<DraftState>(
    thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle",
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [inserted, setInserted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef(0);
  // Set for the duration of a generation the user asked for, so the finished
  // draft goes straight into the compose. See generate().
  const insertOnReady = useRef(false);
  // An auto-draft fires once per thread. Without the guard a re-render (or a
  // live thread event) would spend another draft from the monthly allowance.
  const autoDraftedFor = useRef<string | null>(null);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Restore any draft the thread already has, so re-opening a conversation shows
  // what was written rather than offering to write it again (and charge for it).
  useEffect(() => {
    const token = ++tokenRef.current;
    clearPoll();
    setDraft(null);
    setInserted(false);
    // A draft restored from the server was not asked for just now, so it must
    // not open a compose on its own.
    insertOnReady.current = false;
    setState(thread.isDrafting ? "loading" : thread.hasDraft ? "ready" : "idle");

    api.draftQuota(workspaceId).then((q) => {
      if (token === tokenRef.current) setQuota(q);
    }).catch(() => {});

    api
      .threadDrafts(workspaceId, thread.id)
      .then(({ drafts }) => {
        if (token !== tokenRef.current) return;
        const latest = drafts[0];
        if (latest?.status === "GENERATING" || (!latest && thread.isDrafting)) {
          setState("loading");
          startPoll(thread.id, token);
        } else if (latest?.status === "PROPOSED" || latest?.status === "SENT") {
          setDraft(latest);
          setState("ready");
        }
      })
      .catch(() => {});

    return () => {
      tokenRef.current++;
      clearPoll();
    };
  }, [thread.id, workspaceId]);

  /**
   * Show a finished draft, and hand it to the compose when this generation was
   * one the user asked for. Both the immediate and the polled completion land
   * here so the auto-insert cannot depend on which way the draft arrived.
   */
  function present(d: Draft) {
    setDraft(d);
    setState("ready");
    if (insertOnReady.current) {
      insertOnReady.current = false;
      void insertInto(d);
    }
  }

  function startPoll(threadId: string, token: number) {
    pollRef.current = setInterval(() => {
      api
        .threadDrafts(workspaceId, threadId)
        .then(({ drafts }) => {
          if (token !== tokenRef.current) return;
          const d = drafts[0];
          if (d?.status === "GENERATING") return;
          clearPoll();
          if (d?.status === "PROPOSED") {
            present(d);
          } else {
            setState("error");
          }
        })
        .catch(() => {
          if (token !== tokenRef.current) return;
          clearPoll();
          setState("error");
        });
    }, POLL_INTERVAL_MS);
  }

  function generate(opts: { force?: boolean } = {}) {
    const token = tokenRef.current;
    // Asking for a reply is asking for it in the compose, not in the sidebar:
    // the finished draft inserts itself, and the button below is only there to
    // put it back if the user clears the compose.
    //
    // Regeneration is deliberately not auto-inserted. It happens with a compose
    // already open, and this host inserts by opening one — a reply control that
    // only re-focuses the compose already on screen would leave the panel
    // claiming an insertion that never happened.
    insertOnReady.current = canInsert && !opts.force;
    setState("loading");
    api
      .generateDraft(workspaceId, thread.id, opts)
      .then((result) => {
        if (token !== tokenRef.current) return;
        if ("generating" in result) {
          startPoll(thread.id, token);
          return;
        }
        if ("quotaExceeded" in result) {
          insertOnReady.current = false;
          setQuota({ used: result.used, limit: result.limit, resetsAt: result.resetsAt });
          setState(opts.force ? "ready" : "idle");
          return;
        }
        if (result.isNew) setQuota((q) => (q ? { ...q, used: q.used + 1 } : q));
        present(result.draft);
      })
      .catch(() => {
        insertOnReady.current = false;
        if (token === tokenRef.current) setState("error");
      });
  }

  // Deep-linked from an entry point that already expressed the intent (Outlook's
  // ribbon button). Only from "idle", and only once per thread: a thread that
  // already has a draft shows it rather than paying for a second one.
  useEffect(() => {
    if (!autoDraft || state !== "idle") return;
    if (autoDraftedFor.current === thread.id) return;
    autoDraftedFor.current = thread.id;
    generate();
  }, [autoDraft, state, thread.id]);

  /**
   * Put the draft into the mail client's compose and mark it sent-ready.
   *
   * The status flip happens only after the client confirms it took the text: a
   * draft marked SENT that never reached a compose window would quietly
   * disappear from the user's queue with nothing to show for it.
   */
  async function insertInto(d: Draft) {
    const accepted = await insertDraft(draftBodyToHtml(d.body)).catch(() => false);
    if (!accepted) return;
    setInserted(true);
    const optimistic: Draft = { ...d, status: "SENT" };
    setDraft(optimistic);
    api
      .toggleDraftSent(workspaceId, thread.id, d.id, true)
      .then(({ draft: updated }) => setDraft(updated))
      .catch(() => setDraft(d));
  }

  // The last word in the thread is the user's own, so there is nothing to reply
  // to. Messages arrive oldest-first from the detail route.
  const lastSender = thread.messages.at(-1)?.senderEmail ?? null;
  const isOwnLastMessage =
    !!lastSender && lastSender.toLowerCase() === accountEmail.toLowerCase();

  const quotaExhausted = quota !== null && quota.used >= quota.limit;
  const quotaRemaining = quota ? quota.limit - quota.used : 0;
  const quotaResetDate = quota ? formatQuotaResetDate(quota.resetsAt) : null;

  // Sorting is deliberately NOT a precondition: the server drafts an unsorted
  // thread from its own messages, so hiding the button on a PENDING (or
  // QUOTA_BLOCKED) thread would withhold a feature the user still has allowance
  // for. The last-word check stays: there is genuinely nothing to reply to.
  if (isOwnLastMessage) return null;

  return (
    <div className="apn-draft">
      {state === "idle" && (
        <>
          <button
            type="button"
            className="apn-btn apn-btn-primary"
            onClick={() => generate()}
            disabled={quotaExhausted}
          >
            <Trans>Draft a reply</Trans>
          </button>
          {quota !== null && (
            <p className={`apn-quota-line${quotaExhausted ? " is-exhausted" : ""}`}>
              {quotaExhausted ? (
                <Trans>No drafts remaining · resets {quotaResetDate}</Trans>
              ) : (
                <Trans>
                  {quotaRemaining} of {quota.limit} remaining · resets {quotaResetDate}
                </Trans>
              )}
            </p>
          )}
        </>
      )}

      {state === "loading" && (
        <p className="apn-draft-loading" aria-live="polite">
          <span className="apn-skeleton-pulse" aria-hidden />
          <Trans>Writing draft reply…</Trans>
        </p>
      )}

      {state === "error" && (
        <div className="apn-draft-error">
          <span>
            <Trans>Draft generation failed.</Trans>
          </span>
          <button type="button" className="apn-btn apn-btn-secondary" onClick={() => generate()}>
            <Trans>Retry</Trans>
          </button>
        </div>
      )}

      {state === "ready" && draft && (
        <>
          {canInsert && (
            <button
              type="button"
              className="apn-btn apn-btn-primary"
              onClick={() => void insertInto(draft)}
            >
              {inserted ? <Trans>Insert again</Trans> : <Trans>Insert into reply</Trans>}
            </button>
          )}
          {/* No sent toggle here: inserting into the compose already marks the
              draft, and a reader inside their mailbox tracks what they have
              answered in the mailbox itself, not in this sidebar. */}
          <SuggestedDraftCard
            draft={draft}
            onRegenerate={() => generate({ force: true })}
            quota={quota}
          />
        </>
      )}
    </div>
  );
}
