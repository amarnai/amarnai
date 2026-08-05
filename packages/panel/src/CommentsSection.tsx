"use client";

import { useEffect, useRef, useState } from "react";
import { Trans, Plural } from "@lingui/react/macro";
import { readUserIdFromAccessToken } from "@amarnai/api-client";
import type { ApiClient, ThreadCommentsMeta } from "@amarnai/api-client";
import { ThreadCommentsCard, useThreadComments } from "@amarnai/ui/emails";
import type { MemberItem } from "@amarnai/ui/emails";
import type { PanelHost } from "./host.js";
import type { EmailThreadDetail } from "./types.js";

// Team comments on the open thread, as a collapsible section — the header IS
// the panel's "comment button". Collapsed by default so the reading flow stays
// short; while collapsed a lightweight meta fetch drives the count pill, which
// switches to an accent "N new" chip when there is unread activity. Expanding
// activates the shared useThreadComments hook (list + 15s poll + read marker).
// The card itself is the shared em-* component: both stylesheets are loaded in
// every injected host (ClassificationCard precedent).
export function CommentsSection({
  api,
  host,
  workspaceId,
  thread,
  members,
  focusNonce,
}: {
  api: ApiClient;
  host: PanelHost;
  workspaceId: string;
  thread: EmailThreadDetail;
  /** null while the per-workspace member fetch is in flight. */
  members: MemberItem[] | null;
  /**
   * "Open the section and scroll it into view" requests, as a monotonically
   * increasing nonce. 0 = never requested; an initial value > 0 focuses at
   * mount (Outlook's "Comments" ribbon deep-link, autoDraft precedent); every
   * later increment re-focuses a mounted section (the in-page comment bubble
   * relayed through host.onFocusComments).
   */
  focusNonce: number;
}) {
  const [expanded, setExpanded] = useState(focusNonce > 0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [meta, setMeta] = useState<ThreadCommentsMeta | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const seenFocusNonceRef = useRef(0);

  // The comment author check needs the session's own user id; same derivation
  // as the done-mark handler (the server ignores client-supplied actor ids).
  useEffect(() => {
    let cancelled = false;
    void host.tokenStore
      .get()
      .then((tokens) => {
        if (cancelled || !tokens) return;
        setCurrentUserId(readUserIdFromAccessToken(tokens.accessToken));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [host]);

  const comments = useThreadComments(api, workspaceId, thread.id, currentUserId, {
    active: expanded,
  });

  // Nudge a host with an in-page comments badge (the summary-card bubble)
  // whenever the loaded list's size changes — a post, a delete, or the poll
  // discovering a teammate's comment — so the badge refreshes immediately
  // instead of waiting out its own cadence. The first load is baseline, not a
  // change; the ref resets per thread below.
  const seenCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (comments.state.kind !== "ready") return;
    const count = comments.state.comments.length;
    if (seenCountRef.current === null) {
      seenCountRef.current = count;
      return;
    }
    if (count !== seenCountRef.current) {
      seenCountRef.current = count;
      host.notifyCommentsChanged?.();
    }
  }, [comments.state, host]);

  // Collapsed-state badge. Keyed on the thread only: expanding supersedes it
  // (the list itself carries the counts) and collapsing again keeps the last
  // known numbers rather than refetching.
  useEffect(() => {
    setMeta(null);
    seenCountRef.current = null;
    let cancelled = false;
    void api
      .threadCommentsMeta(workspaceId, thread.id)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, thread.id]);

  useEffect(() => {
    if (focusNonce <= seenFocusNonceRef.current) return;
    seenFocusNonceRef.current = focusNonce;
    setExpanded(true);
    sectionRef.current?.scrollIntoView({ block: "start" });
  }, [focusNonce]);

  const total =
    comments.state.kind === "ready" ? comments.state.comments.length : (meta?.total ?? null);
  // Once expanded, the card's own "N new" chip carries the unread signal and
  // the read marker is being advanced, so the header pill returns to the total.
  const pillUnread = expanded ? 0 : (meta?.unread ?? 0);

  return (
    <section ref={sectionRef} className="apn-queue-section apn-comments-section">
      <button
        type="button"
        className="apn-queue-header"
        aria-expanded={expanded}
        aria-controls="apn-comments-body"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="apn-queue-title">
          <Trans>Comments</Trans>
        </span>
        {pillUnread > 0 ? (
          <span className="apn-queue-count apn-queue-count--new">
            <Plural value={pillUnread} one="# new" other="# new" />
          </span>
        ) : (
          total !== null && <span className="apn-queue-count">{total}</span>
        )}
        <span className="apn-queue-chevron" aria-hidden>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {expanded && (
        <div id="apn-comments-body">
          <ThreadCommentsCard
            state={comments.state}
            unread={comments.unread}
            members={members}
            currentUserId={currentUserId}
            posting={comments.posting}
            postError={comments.postError}
            onCreate={comments.create}
            onDelete={comments.remove}
            onRetry={comments.retry}
          />
        </div>
      )}
    </section>
  );
}
