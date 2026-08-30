"use client";

import { useEffect, useState } from "react";
import type { ApiClient, ThreadCommentsMeta } from "@aziru/api-client";
import type { MemberItem } from "./types.js";
import { useThreadComments } from "./useThreadComments.js";
import { ThreadCommentsCard } from "./ThreadCommentsCard.js";

// The web and extension previews' comments widget: the collapsible
// ThreadCommentsCard plus the state it needs. Collapsed by default, one line;
// while collapsed only the lightweight meta fetch runs (for the count and the
// unread chip), and the list + poll + read marker start on expand. Expansion
// persists across thread switches within the pane's life, matching the
// injected panel's CommentsSection. (That panel keeps its own section chrome
// and does not use this wrapper.)
export function ThreadCommentsSection({
  api,
  workspaceId,
  threadId,
  currentUserId,
  members,
  onCommentsSync,
}: {
  api: ApiClient;
  workspaceId: string;
  threadId: string;
  currentUserId: string | null;
  members: MemberItem[] | null;
  /** Called with the loaded list's size whenever it is known or changes (open,
   * post, delete, poll). The loaded list is authoritative and the read marker
   * has just advanced, so the caller can update this thread's comment tag
   * elsewhere (count + clear unread) without waiting for a list refresh. */
  onCommentsSync?: (threadId: string, commentCount: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState<ThreadCommentsMeta | null>(null);

  const comments = useThreadComments(api, workspaceId, threadId, currentUserId, {
    active: expanded,
  });

  // Collapsed-state badge, keyed on the thread only: expanding supersedes it
  // (the list carries live counts from then on).
  useEffect(() => {
    setMeta(null);
    let cancelled = false;
    void api
      .threadCommentsMeta(workspaceId, threadId)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, threadId]);

  // The hook advances the read marker whenever the expanded list is loaded, so
  // "list is ready while expanded" is exactly "this thread was marked read",
  // and the list length is the authoritative comment count. Effect (not a
  // callback from the hook) so it also fires on every length change — post,
  // delete, poll — and when switching threads with the section already
  // expanded.
  const readyCount =
    comments.state.kind === "ready" ? comments.state.comments.length : null;
  useEffect(() => {
    if (expanded && readyCount !== null) onCommentsSync?.(threadId, readyCount);
  }, [expanded, readyCount, threadId, onCommentsSync]);

  return (
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
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      collapsedMeta={meta}
    />
  );
}
