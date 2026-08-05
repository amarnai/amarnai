"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiHttpError,
  type ApiClient,
  type ThreadCommentItem,
} from "@amarnai/api-client";

// Poll cadence while the comment section is open. Comments are human-paced;
// 15s keeps a two-person exchange feeling live without SSE plumbing.
const COMMENT_POLL_INTERVAL_MS = 15_000;

export type ThreadCommentsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; comments: ThreadCommentItem[] };

/** Why the last create failed, mapped from the server's status codes so the UI
 *  can show a specific message for the throttle and per-thread cap. */
export type CommentPostError = "throttled" | "limit" | "generic";

export interface UseThreadCommentsResult {
  state: ThreadCommentsState;
  /** Comments new to the caller when they opened this thread's section
   *  (authored by others, newer than their read marker). Stable for the
   *  viewing session; the server-side marker is advanced in the background so
   *  it reads as zero on the next visit. */
  unread: number;
  posting: boolean;
  postError: CommentPostError | null;
  create: (body: string, mentionUserIds: string[]) => Promise<boolean>;
  remove: (commentId: string) => Promise<void>;
  retry: () => void;
}

/**
 * Fetch-on-open + poll-while-open state for a thread's comments. `active` is
 * the section's visibility: nothing is fetched until it becomes true (the
 * injected panel's collapsed section), and polling stops when it goes false.
 * Thread switches invalidate in-flight work via a key ref — the surfaces
 * re-render in place rather than remounting (ThreadPreview precedent).
 */
export function useThreadComments(
  api: ApiClient,
  workspaceId: string,
  threadId: string,
  currentUserId: string | null,
  opts: { active: boolean },
): UseThreadCommentsResult {
  const { active } = opts;
  const key = `${workspaceId}:${threadId}`;

  const [state, setState] = useState<ThreadCommentsState>({ kind: "loading" });
  const [unread, setUnread] = useState(0);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<CommentPostError | null>(null);

  // Invalidates async work from a previous thread; also gates the one-time
  // unread computation and the read-marker upsert per thread view.
  const keyRef = useRef(key);
  const unreadComputedRef = useRef(false);
  // ISO createdAt of the newest comment the read marker covers; a fresh mark is
  // only sent when something newer arrived, so the poll is not write-chatty.
  const markedThroughRef = useRef<string | null>(null);

  useEffect(() => {
    keyRef.current = key;
    unreadComputedRef.current = false;
    markedThroughRef.current = null;
    setState({ kind: "loading" });
    setUnread(0);
    setPostError(null);
  }, [key]);

  const markRead = useCallback(
    (comments: ThreadCommentItem[]) => {
      const newest = comments.length > 0 ? comments[comments.length - 1]!.createdAt : null;
      if (markedThroughRef.current !== null && (newest === null || newest <= markedThroughRef.current)) {
        return;
      }
      markedThroughRef.current = newest ?? "";
      // Best-effort: a failed marker upsert only means the badge reappears later.
      void api.markThreadCommentsRead(workspaceId, threadId).catch(() => {});
    },
    [api, workspaceId, threadId],
  );

  const fetchComments = useCallback(async () => {
    const requestKey = keyRef.current;
    try {
      const result = await api.listThreadComments(workspaceId, threadId);
      if (keyRef.current !== requestKey) return;
      if (!unreadComputedRef.current) {
        unreadComputedRef.current = true;
        const since = result.lastReadAt;
        setUnread(
          result.comments.filter(
            (c) =>
              c.author.userId !== currentUserId &&
              (since === null || c.createdAt > since),
          ).length,
        );
      }
      setState({ kind: "ready", comments: result.comments });
      markRead(result.comments);
    } catch {
      if (keyRef.current !== requestKey) return;
      // Keep an already-loaded list on a failed poll; only surface the error
      // state when there is nothing to show.
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "error" }));
    }
  }, [api, workspaceId, threadId, currentUserId, markRead]);

  useEffect(() => {
    if (!active) return;
    void fetchComments();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void fetchComments();
    }, COMMENT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, fetchComments]);

  const create = useCallback(
    async (body: string, mentionUserIds: string[]): Promise<boolean> => {
      const requestKey = keyRef.current;
      setPosting(true);
      setPostError(null);
      try {
        const result = await api.createThreadComment(workspaceId, threadId, {
          body,
          mentionUserIds,
        });
        if (keyRef.current !== requestKey) return true;
        setState((prev) =>
          prev.kind === "ready"
            ? { kind: "ready", comments: [...prev.comments, result.comment] }
            : prev,
        );
        markRead([result.comment]);
        return true;
      } catch (err) {
        if (keyRef.current !== requestKey) return false;
        if (err instanceof ApiHttpError && err.status === 429) setPostError("throttled");
        else if (err instanceof ApiHttpError && err.status === 409) setPostError("limit");
        else setPostError("generic");
        return false;
      } finally {
        setPosting(false);
      }
    },
    [api, workspaceId, threadId, markRead],
  );

  const remove = useCallback(
    async (commentId: string): Promise<void> => {
      const requestKey = keyRef.current;
      try {
        await api.deleteThreadComment(workspaceId, threadId, commentId);
        if (keyRef.current !== requestKey) return;
        setState((prev) =>
          prev.kind === "ready"
            ? { kind: "ready", comments: prev.comments.filter((c) => c.id !== commentId) }
            : prev,
        );
      } catch {
        // The delete may have raced a poll or actually failed; re-sync.
        if (keyRef.current === requestKey) void fetchComments();
      }
    },
    [api, workspaceId, threadId, fetchComments],
  );

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    void fetchComments();
  }, [fetchComments]);

  return { state, unread, posting, postError, create, remove, retry };
}
