"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, FilterCounts } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem, MemberItem } from "./types.js";
import { queueCountsFromServer } from "./selection.js";
import { mapThreads, mapThreadDetail } from "./mapThreads.js";
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
  // Server-computed inbox counts (over the whole inbox, not the loaded page) from
  // the initial fetch. Drives the queue-pill totals and the "X of Y" indicator.
  initialCounts?: FilterCounts | undefined;
  // Count of threads matching the initial view (the "All" queue, no search).
  initialFilteredTotal?: number | undefined;
};

const EMPTY_COUNTS: FilterCounts = {
  total: 0, PENDING: 0, PENDING_WAITING: 0, NEEDS_REVIEW: 0, SORTED: 0, UNROUTED: 0, UNCLASSIFIED: 0, important: 0, assigned: 0,
};

// Auto-load successive pages up to this many threads so a normal inbox fills in
// without scrolling. Beyond it, the explicit "Load more" control takes over (a
// guard against pulling thousands of rows into the DOM without virtualization).
const AUTO_LOAD_CAP = 200;

// Debounce window for search input before hitting the server.
const SEARCH_DEBOUNCE_MS = 300;

type ViewParams = { nodeId?: string; status?: string; important?: boolean; assigned?: boolean; q?: string };

// Translate the active view (queue or folder) + search term into the server-side
// filter params, so the list, count, and search all come from one query.
function viewParams(active: ActiveSelection, query: string): ViewParams {
  const q = query.trim() || undefined;
  if (active.kind === "folder") return { nodeId: active.id, ...(q ? { q } : {}) };
  const base: ViewParams = q ? { q } : {};
  switch (active.id) {
    case "sorted":       return { ...base, status: "SORTED" };
    case "review":       return { ...base, status: "NEEDS_REVIEW" };
    case "pending":      return { ...base, status: "PENDING" };
    case "important":    return { ...base, important: true };
    case "assigned":     return { ...base, assigned: true };
    case "unrouted":     return { ...base, status: "UNROUTED" };
    case "unclassified": return { ...base, status: "UNCLASSIFIED" };
    case "all":
    default:             return base;
  }
}

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
  const { api, workspaceId, currentUserId, initialThreads, initialFolders, initialActive, initialSelectedId, initialNextCursor, initialCounts, initialFilteredTotal } =
    options;

  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Server-computed inbox counts. Drives the queue-pill totals and the "X of Y"
  // indicator; refreshed whenever the server returns fresh counts.
  const [counts, setCounts] = useState<FilterCounts>(
    initialCounts ?? { ...EMPTY_COUNTS, total: initialThreads.length },
  );
  // Count of threads matching the active view + search (server-computed), shown
  // as "X threads". Distinct from `counts` (the whole-inbox pill totals).
  const [filteredTotal, setFilteredTotal] = useState<number>(initialFilteredTotal ?? initialThreads.length);
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

  // Current view (queue/folder) + search, kept in refs so the stable refresh/
  // loadMore callbacks always query the active view.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

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

  // Re-fetch the active view's first page and merge it in (preserving already-
  // loaded later pages and in-progress draft state). Used by the SSE/poll refresh
  // triggers; the returned nextCursor is ignored since the deeper pagination
  // cursor in state is the one that matters.
  const refresh = useCallback(() => {
    return api
      .emailThreads(workspaceId, viewParams(activeRef.current, queryRef.current))
      .then(({ threads: fresh, counts: freshCounts, filteredTotal: ft }) => {
        syncThreads(mapThreads(fresh));
        setCounts(freshCounts);
        setFilteredTotal(ft);
      })
      .catch(() => {});
  }, [api, workspaceId, syncThreads]);

  // Fetch a single thread by id and insert it into the list if it isn't already
  // loaded. Lets a deep-link (e.g. opening a thread from a notification) render
  // its preview even when the thread falls outside the current view or page.
  // No-op when the thread is already present.
  const loadThread = useCallback((threadId: string) => {
    if (threadsRef.current.some((t) => t.id === threadId)) return Promise.resolve();
    return api
      .emailThread(workspaceId, threadId)
      .then((detail) => {
        setThreads((prev) =>
          prev.some((t) => t.id === threadId) ? prev : [mapThreadDetail(detail), ...prev]
        );
      })
      .catch(() => {});
  }, [api, workspaceId]);

  // ─── Pagination ──────────────────────────────────────────────────────────────

  const hasMore = nextCursor !== null;

  // Fetch and append the next page of the active view. No-op when there is no
  // next page or a fetch is already in flight.
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    hasPaginatedRef.current = true;
    setLoadingMore(true);
    try {
      const { threads: page, nextCursor: cursorAfter, counts: freshCounts, filteredTotal: ft } =
        await api.emailThreads(workspaceId, { ...viewParams(activeRef.current, queryRef.current), cursor });
      setThreads((prev) => appendThreads(prev, mapThreads(page)));
      setNextCursor(cursorAfter);
      setCounts(freshCounts);
      setFilteredTotal(ft);
    } catch {
      // Non-fatal — the auto-load effect / Load more button will retry.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [api, workspaceId]);

  // Server-driven list: whenever the active view (queue/folder) or the search
  // term changes, fetch that view's first page and replace the list. Search is
  // debounced; switching views is immediate. The initial render is seeded from
  // props, so skip the very first run.
  const didMountRef = useRef(false);
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      lastQueryRef.current = query;
      return;
    }
    const isSearchChange = query !== lastQueryRef.current;
    lastQueryRef.current = query;
    const handle = setTimeout(() => {
      hasPaginatedRef.current = false;
      api
        .emailThreads(workspaceId, viewParams(active, query))
        .then(({ threads: fresh, nextCursor: c, counts: freshCounts, filteredTotal: ft }) => {
          setThreads(mapThreads(fresh));
          setNextCursor(c);
          setCounts(freshCounts);
          setFilteredTotal(ft);
        })
        .catch(() => {});
    }, isSearchChange ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(handle);
  }, [active, query, api, workspaceId]);

  // Auto-load successive pages so a normal inbox fills in without scrolling.
  // Chains: each completed page re-runs this effect until there are no more
  // pages or the cap is reached (beyond which the user loads more explicitly).
  useEffect(() => {
    if (hasMore && !loadingMore && threads.length < AUTO_LOAD_CAP) {
      void loadMore();
    }
  }, [hasMore, loadingMore, threads.length, loadMore]);

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

  // ─── Assign ────────────────────────────────────────────────────────────────
  //
  // Set the assignee to `member`, or clear it when `member` is null. The
  // member's real name/email is available on the client, so the optimistic
  // assignment shows the right label immediately: unlike the done mark, we
  // don't need to wait for the server to learn who it is.

  const handleAssign = useCallback((threadId: string, member: MemberItem | null) => {
    const prev = threadsRef.current.find((t) => t.id === threadId);
    const optimistic = member
      ? {
          userId: member.userId,
          userName: member.name,
          userEmail: member.email,
          assignedAt: new Date().toISOString(),
        }
      : null;
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, assignment: optimistic } : t))
    );
    const request = member
      ? api.assignThread(workspaceId, threadId, member.userId).then(({ assignment }) => assignment)
      : api.unassignThread(workspaceId, threadId).then(() => null);
    request
      .then((assignment) => {
        setThreads((ts) =>
          ts.map((t) => (t.id === threadId ? { ...t, assignment } : t))
        );
      })
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });
  }, [api, workspaceId]);

  // ─── Important ───────────────────────────────────────────────────────────────
  //
  // Toggle the user-marked "important" star. Optimistic: flip locally, persist,
  // and roll back on failure. The star is a shared workspace flag, so no user id
  // is needed.

  const handleToggleImportant = useCallback((threadId: string) => {
    const prev = threadsRef.current.find((t) => t.id === threadId);
    if (!prev) return;
    const next = !prev.isImportant;
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, isImportant: next } : t))
    );
    // Keep the Important pill total in step with the optimistic flip.
    setCounts((c) => ({ ...c, important: Math.max(0, c.important + (next ? 1 : -1)) }));
    api
      .setThreadImportant(workspaceId, threadId, next)
      .catch(() => {
        setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
        setCounts((c) => ({ ...c, important: Math.max(0, c.important + (next ? -1 : 1)) }));
      });
  }, [api, workspaceId]);

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
  // "Route now" enqueues the whole waiting backlog, so also zero the server
  // waiting counts immediately — otherwise the banner (which reads them) would
  // linger until the next refresh.
  const markWaitingClassifying = useCallback(() => {
    setThreads((prev) =>
      prev.map((t) => (isWaiting(t) ? { ...t, isClassifying: true } : t))
    );
    setCounts((c) => ({ ...c, PENDING: 0, PENDING_WAITING: 0, UNROUTED: 0 }));
  }, [isWaiting]);

  // ─── Derived ─────────────────────────────────────────────────────────────────

  // The list is filtered server-side (active view + search), so the loaded
  // threads are already the displayed set — no client-side re-filtering.
  const filteredThreads = threads;
  const filteredIds = filteredThreads.map((t) => t.id);

  const selectedThread = selectedId
    ? threads.find((t) => t.id === selectedId) ?? null
    : null;

  const anyClassifying = threads.some((t) => t.isClassifying);

  const waitingCount = threads.filter(isWaiting).length;

  // Server-authoritative totals (whole inbox) for the "X of Y" footer and the
  // queue pills, so they never reflect just the loaded page.
  const total = counts.total;
  const queueCounts = queueCountsFromServer(counts);
  // Whole-inbox count of threads waiting to be routed (PENDING + legacy
  // UNROUTED). Drives the "Route now" banner so it matches the Pending pill
  // rather than only the loaded page.
  const serverWaitingCount = counts.PENDING_WAITING + counts.UNROUTED;

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
    loadThread,
    // pagination + counts
    hasMore,
    loadingMore,
    loadMore,
    total,
    queueCounts,
    serverWaitingCount,
    filteredTotal,
    // mutations
    handleApprove,
    handleMarkDone,
    handleUnmarkDone,
    handleAssign,
    handleToggleImportant,
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
