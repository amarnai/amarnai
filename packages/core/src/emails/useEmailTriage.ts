"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem } from "./types.js";
import { filterThreads } from "./selection.js";
import { mapThreads } from "./mapThreads.js";
import { mergeThreads } from "./mergeThreads.js";
import { appendThreads } from "./appendThreads.js";

export type Toast = { message: string; onUndo?: () => void };

export type RerouteTarget = { kind: "single"; threadId: string } | null;

export type UseEmailTriageOptions = {
  api: ApiClient;
  workspaceId: string;
  currentUserId: string;
  initialThreads: ThreadItem[];
  initialFolders: FolderItem[];
  initialActive: ActiveSelection;
  initialSelectedId: string | null;
  // Opaque cursor for the next page of threads, from the initial server fetch.
  // null/undefined means the first page was the last (no pagination).
  initialNextCursor?: string | null;
};

/**
 * Platform-agnostic email triage view-model. Owns the thread list, selection,
 * search query, optimistic mutation handlers (approve / reroute / mark done /
 * draft state), and the toast. It contains no rendering, navigation, or DOM:
 * the web app and the mobile app each wrap the returned state + setters with
 * their own routing, layout, and JSX.
 *
 * Server/refresh triggers are also left to the caller — call `syncThreads` with
 * a fresh mapped list (web: on Next server-prop refresh; mobile: after a poll),
 * or call `refresh` to fetch-and-merge through the injected api client.
 *
 * All returned functions have stable identity (useCallback + refs), so callers
 * that split state from actions (e.g. the mobile context provider) can memoize
 * the action surface and avoid re-rendering action-only consumers on state
 * changes. Handlers that need the latest thread/reroute state read it through
 * refs rather than closures, mirroring the `selectedIdRef` pattern.
 */
export function useEmailTriage(options: UseEmailTriageOptions) {
  const { api, workspaceId, currentUserId, initialThreads, initialFolders, initialActive, initialSelectedId, initialNextCursor } =
    options;

  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [folders] = useState<FolderItem[]>(initialFolders);
  const [active, setActive] = useState<ActiveSelection>(initialActive);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [query, setQuery] = useState("");
  const [rerouteTarget, setRerouteTarget] = useState<RerouteTarget>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Always-current refs so stable (useCallback) handlers can read the latest
  // state without listing it as a dependency (which would churn their identity).
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const rerouteTargetRef = useRef(rerouteTarget);
  useEffect(() => {
    rerouteTargetRef.current = rerouteTarget;
  }, [rerouteTarget]);

  // Always-current cursor + in-flight guard so loadMore keeps a stable identity
  // while still reading the latest pagination state.
  const nextCursorRef = useRef(nextCursor);
  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);
  const loadingMoreRef = useRef(false);
  // True once the user has loaded pages beyond the first. Gates whether a
  // page-1 refresh preserves later pages (it should) versus straight-replacing
  // (so trashed/removed threads disappear) when no pagination has happened.
  const hasPaginatedRef = useRef(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Toast ───────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: Toast) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ─── Thread sync ─────────────────────────────────────────────────────────────

  // Merge a fresh mapped thread list into local state, preserving in-progress
  // draft state and the pinned (selected) thread.
  const syncThreads = useCallback((fresh: ThreadItem[]) => {
    setThreads((prev) => mergeThreads(fresh, prev, selectedIdRef.current, hasPaginatedRef.current));
  }, []);

  // Fetch the latest threads from the server and merge them in. This only ever
  // re-fetches the first page; mergeThreads keeps already-loaded later pages, so
  // a refresh updates statuses without collapsing a paginated list. The returned
  // nextCursor (page 2) is intentionally ignored — the deeper pagination cursor
  // tracked in state is the one that matters.
  const refresh = useCallback(() => {
    return api
      .emailThreads(workspaceId)
      .then(({ threads: fresh }) => syncThreads(mapThreads(fresh)))
      .catch(() => {});
  }, [api, workspaceId, syncThreads]);

  // ─── Pagination ──────────────────────────────────────────────────────────────

  const hasMore = nextCursor !== null;

  // Fetch and append the next page of threads. No-op when there is no next page
  // or a fetch is already in flight (so a fast-scrolling list does not fire
  // overlapping requests). Drives the web infinite-scroll sentinel and the
  // mobile list's onEndReached.
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    hasPaginatedRef.current = true;
    setLoadingMore(true);
    try {
      const { threads: page, nextCursor: cursorAfter } = await api.emailThreads(
        workspaceId,
        { cursor },
      );
      setThreads((prev) => appendThreads(prev, mapThreads(page)));
      setNextCursor(cursorAfter);
    } catch {
      // Non-fatal — the sentinel/onEndReached will retry on the next trigger.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [api, workspaceId]);

  // ─── Approve ───────────────────────────────────────────────────────────────

  const handleApprove = useCallback((threadId: string) => {
    const prev = threadsRef.current.find((t) => t.id === threadId);
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, status: "sorted" as const } : t))
    );
    api
      .triageThread(workspaceId, threadId, { action: "approve" })
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });
    showToast({ message: "Routing approved" });
  }, [api, workspaceId, showToast]);

  // ─── Mark done ─────────────────────────────────────────────────────────────

  const handleMarkDone = useCallback((threadId: string) => {
    const prev = threadsRef.current.find((t) => t.id === threadId);
    const optimisticMark = {
      userId: currentUserId,
      userName: null,
      userEmail: "",
      resolvedAt: new Date().toISOString(),
    };
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, doneMark: optimisticMark } : t))
    );
    api
      .markThreadDone(workspaceId, threadId, currentUserId)
      .then(({ doneMark }) => {
        setThreads((ts) =>
          ts.map((t) => (t.id === threadId ? { ...t, doneMark } : t))
        );
      })
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });
  }, [api, workspaceId, currentUserId]);

  const handleUnmarkDone = useCallback((threadId: string) => {
    const prev = threadsRef.current.find((t) => t.id === threadId);
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, doneMark: null } : t))
    );
    api
      .unmarkThreadDone(workspaceId, threadId, currentUserId)
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });
  }, [api, workspaceId, currentUserId]);

  // ─── Reroute ─────────────────────────────────────────────────────────────────

  const openRerouteFor = useCallback((threadId: string) => {
    setRerouteTarget({ kind: "single", threadId });
  }, []);

  const closeReroute = useCallback(() => {
    setRerouteTarget(null);
  }, []);

  const commitReroute = useCallback((folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    const folderName = folder?.name ?? "folder";

    const target = rerouteTargetRef.current;
    if (!target) return;

    const { threadId } = target;
    const prev = threadsRef.current.find((t) => t.id === threadId);
    setThreads((ts) =>
      ts.map((t) =>
        t.id === threadId ? { ...t, folderId, status: "sorted" as const } : t
      )
    );
    api
      .triageThread(workspaceId, threadId, { action: "move", nodeId: folderId })
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });

    if (prev) {
      showToast({
        message: `Moved to ${folderName}`,
        onUndo: () => {
          const oldFolderId = prev.folderId;
          setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
          if (oldFolderId) {
            api
              .triageThread(workspaceId, threadId, { action: "move", nodeId: oldFolderId })
              .catch(() => {});
          }
        },
      });
    } else {
      showToast({ message: `Moved to ${folderName}` });
    }

    setRerouteTarget(null);
  }, [api, workspaceId, folders, showToast]);

  // ─── Draft state ───────────────────────────────────────────────────────────

  const handleDraftStarted = useCallback((threadId: string) => {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, isDrafting: true } : t))
    );
  }, []);

  const handleDraftFailed = useCallback((threadId: string) => {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, isDrafting: false } : t))
    );
  }, []);

  const handleDraftGenerated = useCallback((threadId: string) => {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, hasDraft: true, isDrafting: false } : t))
    );
  }, []);

  const handleDraftSentToggled = useCallback((threadId: string, sent: boolean) => {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, hasDraft: !sent } : t))
    );
  }, []);

  // ─── Reroute unclassified ──────────────────────────────────────────────────

  const handleReroute = useCallback(() => {
    api
      .rerouteUnclassified(workspaceId)
      .then(() => {
        showToast({ message: "Re-routing unclassified threads" });
      })
      .catch(() => {});
  }, [api, workspaceId, showToast]);

  // Threads waiting to be routed: not yet sorted and not actively classifying.
  // These are routed only on an explicit "Route now" click, never automatically.
  const isWaiting = useCallback(
    (t: ThreadItem) =>
      !t.isClassifying && (t.status === "unsorted" || t.status === "unrouted"),
    [],
  );

  // Optimistically mark waiting threads as classifying (used after a "Route now"
  // click so the banner hides and the "Sorting…" indicator shows until refresh).
  const markWaitingClassifying = useCallback(() => {
    setThreads((prev) =>
      prev.map((t) => (isWaiting(t) ? { ...t, isClassifying: true } : t))
    );
  }, [isWaiting]);

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const filteredThreads = filterThreads(threads, folders, active, "all", query);
  const filteredIds = filteredThreads.map((t) => t.id);

  const selectedThread = selectedId
    ? threads.find((t) => t.id === selectedId) ?? null
    : null;

  const anyClassifying = threads.some((t) => t.isClassifying);

  const waitingCount = threads.filter(isWaiting).length;

  return {
    // state
    threads,
    folders,
    active,
    selectedId,
    selectedThread,
    query,
    rerouteTarget,
    toast,
    // derived
    filteredThreads,
    filteredIds,
    anyClassifying,
    waitingCount,
    isWaiting,
    // setters
    setActive,
    setSelectedId,
    setQuery,
    // thread sync
    syncThreads,
    refresh,
    // pagination
    hasMore,
    loadingMore,
    loadMore,
    // mutations
    handleApprove,
    handleMarkDone,
    handleUnmarkDone,
    openRerouteFor,
    closeReroute,
    commitReroute,
    handleDraftStarted,
    handleDraftFailed,
    handleDraftGenerated,
    handleDraftSentToggled,
    handleReroute,
    markWaitingClassifying,
    // toast
    showToast,
    dismissToast,
  };
}
