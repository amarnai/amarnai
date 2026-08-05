"use client";

import { useState } from "react";
import { Trans, Plural } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { MAX_COMMENT_LENGTH, MAX_MENTIONS_PER_COMMENT } from "@amarnai/shared";
import type { ThreadCommentItem, ThreadCommentsMeta } from "@amarnai/api-client";
import type { MemberItem } from "./types.js";
import { formatDateTime } from "./formatDateTime.js";
import { MentionTextarea } from "./MentionTextarea.js";
import { findMentionSegments } from "./mentionSegments.js";
import type { CommentPostError, ThreadCommentsState } from "./useThreadComments.js";

export interface ThreadCommentsCardProps {
  state: ThreadCommentsState;
  /** Comments new to the viewer when they opened the section; renders the
   *  "N new" chip. */
  unread: number;
  members: MemberItem[] | null;
  currentUserId: string | null;
  posting: boolean;
  postError: CommentPostError | null;
  onCreate: (body: string, mentionUserIds: string[]) => Promise<boolean>;
  onDelete: (commentId: string) => void;
  onRetry: () => void;
  /**
   * When set, the card is collapsible: the eyebrow becomes a one-line toggle
   * button and the body only renders while `expanded`. Absent (the injected
   * panel, which brings its own section header), the card is always open.
   */
  onToggle?: () => void;
  expanded?: boolean;
  /** Counts shown in the collapsed header before the list has ever loaded. */
  collapsedMeta?: ThreadCommentsMeta | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cosmetic mention highlighting: wraps `@Name` substrings for the comment's
// stored mention ids, resolved against the current member list. Renames or a
// missing member list degrade to plain text — notifications were driven by the
// stored ids at create time, never by this rendering.
function renderBody(
  body: string,
  mentionUserIds: string[],
  members: MemberItem[] | null,
): React.ReactNode {
  if (mentionUserIds.length === 0 || !members) return body;
  const labels = mentionUserIds
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is MemberItem => m !== undefined)
    .map((m) => `@${m.name ?? m.email}`)
    .sort((a, b) => b.length - a.length);
  if (labels.length === 0) return body;
  const pattern = new RegExp(`(${labels.map(escapeRegExp).join("|")})`, "g");
  const parts = body.split(pattern);
  if (parts.length === 1) return body;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="em-comment-mention">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// Quiet inset card (ThreadSummaryCard treatment) holding the comment list and
// the mention-aware composer. Pure presentation: the caller owns fetching and
// mutation via useThreadComments.
export function ThreadCommentsCard({
  state,
  unread,
  members,
  currentUserId,
  posting,
  postError,
  onCreate,
  onDelete,
  onRetry,
  onToggle,
  expanded,
  collapsedMeta,
}: ThreadCommentsCardProps) {
  const { _, i18n } = useLingui();
  const [body, setBody] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    // Tags are derived from the text itself (the same resolution the composer
    // highlights in accent), so what reads as a valid tag is exactly what is
    // sent; the server re-validates each id against workspace membership.
    const mentionUserIds = [
      ...new Set(findMentionSegments(trimmed, members).map((s) => s.userId)),
    ].slice(0, MAX_MENTIONS_PER_COMMENT);
    const ok = await onCreate(trimmed, mentionUserIds);
    if (ok) setBody("");
  }

  const collapsible = onToggle !== undefined;
  const isExpanded = !collapsible || expanded === true;
  const ready = state.kind === "ready";
  // Counts: the loaded list is authoritative; before it ever loads (collapsed),
  // the lightweight meta fetch stands in. Once the list has loaded, collapsing
  // again shows live totals and no unread (the read marker was just advanced).
  const totalCount = ready ? state.comments.length : (collapsedMeta?.total ?? 0);
  const newCount = isExpanded ? unread : ready ? 0 : (collapsedMeta?.unread ?? 0);

  const headerContent = (
    <>
      <Trans>Comments</Trans>
      {totalCount > 0 && <span className="em-comments-count">({totalCount})</span>}
      {newCount > 0 && (
        <span className="em-comments-new">
          <Plural value={newCount} one="# new" other="# new" />
        </span>
      )}
      {collapsible && (
        <span className="em-comments-chevron" aria-hidden>
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
      )}
    </>
  );

  return (
    <section
      className={`em-summary-card em-comments-card${collapsible && !isExpanded ? " is-collapsed" : ""}`}
      aria-label={_(msg`Comments`)}
    >
      {collapsible ? (
        <button
          type="button"
          className="em-summary-eyebrow em-comments-toggle"
          aria-expanded={isExpanded}
          onClick={onToggle}
        >
          {headerContent}
        </button>
      ) : (
        <div className="em-summary-eyebrow">{headerContent}</div>
      )}

      {isExpanded && state.kind === "loading" && (
        <div className="em-comments-loading">
          <span className="em-summary-skeleton-pulse" />
          <Trans>Loading comments…</Trans>
        </div>
      )}

      {isExpanded && state.kind === "error" && (
        <div className="em-comments-error">
          <Trans>Comments could not be loaded.</Trans>
          <button type="button" className="em-btn ghost" onClick={onRetry}>
            <Trans>Retry</Trans>
          </button>
        </div>
      )}

      {isExpanded && state.kind === "ready" && (
        <>
          {state.comments.length === 0 ? (
            <div className="em-comments-empty">
              <Trans>No comments yet. Start the discussion.</Trans>
            </div>
          ) : (
            <div className="em-comment-list">
              {state.comments.map((comment: ThreadCommentItem) => (
                <div key={comment.id} className="em-comment-item">
                  <div className="em-comment-meta">
                    <span className="em-comment-author">
                      {comment.author.name ?? comment.author.email}
                    </span>
                    <span className="em-comment-time">
                      {formatDateTime(new Date(comment.createdAt))}
                    </span>
                    {comment.author.userId === currentUserId && (
                      <button
                        type="button"
                        className="em-comment-delete"
                        onClick={() => onDelete(comment.id)}
                        aria-label={_(msg`Delete comment`)}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                          <path
                            d="M1.5 3h9M4.5 3V2a1 1 0 011-1h1a1 1 0 011 1v1M2.5 3l.45 6.6a1 1 0 001 .9h4.1a1 1 0 001-.9L9.5 3"
                            stroke="currentColor"
                            strokeWidth="1.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4.9 5.2v3.3M7.1 5.2v3.3"
                            stroke="currentColor"
                            strokeWidth="1.1"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="em-comment-body">
                    {renderBody(comment.body, comment.mentionUserIds, members)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form className="em-comment-composer" onSubmit={handleSubmit}>
            <MentionTextarea
              value={body}
              onChange={setBody}
              members={members}
              disabled={posting}
              placeholder={i18n._(msg`Add a comment. Type @ to mention a teammate.`)}
              maxLength={MAX_COMMENT_LENGTH}
            />
            {postError !== null && (
              <p className="em-comment-error" role="alert">
                {postError === "throttled" ? (
                  <Trans>You are commenting too fast. Try again in a moment.</Trans>
                ) : postError === "limit" ? (
                  <Trans>This thread has reached its comment limit.</Trans>
                ) : (
                  <Trans>The comment could not be posted. Try again.</Trans>
                )}
              </p>
            )}
            <div className="em-comment-actions">
              <button
                type="submit"
                className="em-btn"
                disabled={posting || body.trim().length === 0}
              >
                {posting ? <Trans>Posting…</Trans> : <Trans>Comment</Trans>}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
