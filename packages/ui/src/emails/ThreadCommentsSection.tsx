"use client";

import { useEffect, useState } from "react";
import type { ApiClient, ThreadCommentsMeta } from "@amarnai/api-client";
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
}: {
  api: ApiClient;
  workspaceId: string;
  threadId: string;
  currentUserId: string | null;
  members: MemberItem[] | null;
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
