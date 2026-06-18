"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem } from "./types.js";
import { filterThreads } from "./selection.js";
import { mapThreads } from "./mapThreads.js";
import { mergeThreads } from "./mergeThreads.js";

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
 */
export function useEmailTriage(options: UseEmailTriageOptions) {
  const { api, workspaceId, currentUserId, initialThreads, initialFolders, initialActive, initialSelectedId } =
    options;

  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  const [folders] = useState<FolderItem[]>(initialFolders);
  const [active, setActive] = useState<ActiveSelection>(initialActive);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [query, setQuery] = useState("");
  const [rerouteTarget, setRerouteTarget] = useState<RerouteTarget>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Always-current ref so async callbacks (refresh, fetch) can read the latest
  // selectedId without being added to effect deps.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Thread sync ─────────────────────────────────────────────────────────────

  // Merge a fresh mapped thread list into local state, preserving in-progress
  // draft state and the pinned (selected) thread.
  function syncThreads(fresh: ThreadItem[]) {
    setThreads((prev) => mergeThreads(fresh, prev, selectedIdRef.current));
  }

  // Fetch the latest threads from the server and merge them in.
  function refresh() {
    return api
      .emailThreads(workspaceId)
      .then(({ threads: fresh }) => syncThreads(mapThreads(fresh)))
      .catch(() => {});
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  function showToast(msg: Toast) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function dismissToast() {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }

  // ─── Approve ───────────────────────────────────────────────────────────────

  function handleApprove(threadId: string) {
    const prev = threads.find((t) => t.id === threadId);
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, status: "sorted" as const } : t))
    );
    api
      .triageThread(workspaceId, threadId, { action: "approve" })
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });
    showToast({ message: "Routing approved" });
  }

  // ─── Mark done ─────────────────────────────────────────────────────────────

  function handleMarkDone(threadId: string) {
    const prev = threads.find((t) => t.id === threadId);
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
  }

  function handleUnmarkDone(threadId: string) {
    const prev = threads.find((t) => t.id === threadId);
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, doneMark: null } : t))
    );
    api
      .unmarkThreadDone(workspaceId, threadId, currentUserId)
      .catch(() => {
        if (prev) setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
      });
  }

  // ─── Reroute ─────────────────────────────────────────────────────────────────

  function openRerouteFor(threadId: string) {
    setRerouteTarget({ kind: "single", threadId });
  }

  function closeReroute() {
    setRerouteTarget(null);
  }

  function commitReroute(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    const folderName = folder?.name ?? "folder";

    if (!rerouteTarget) return;

    const { threadId } = rerouteTarget;
    const prev = threads.find((t) => t.id === threadId);
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
  }

  // ─── Draft state ───────────────────────────────────────────────────────────

  function handleDraftStarted(threadId: string) {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, isDrafting: true } : t))
    );
  }

  function handleDraftFailed(threadId: string) {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, isDrafting: false } : t))
    );
  }

  function handleDraftGenerated(threadId: string) {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, hasDraft: true, isDrafting: false } : t))
    );
  }

  function handleDraftSentToggled(threadId: string, sent: boolean) {
    setThreads((ts) =>
      ts.map((t) => (t.id === threadId ? { ...t, hasDraft: !sent } : t))
    );
  }

  // ─── Reroute unclassified ──────────────────────────────────────────────────

  function handleReroute() {
    api
      .rerouteUnclassified(workspaceId)
      .then(() => {
        showToast({ message: "Re-routing unclassified threads" });
      })
      .catch(() => {});
  }

  // Optimistically mark waiting threads as classifying (used after a "Route now"
  // click so the banner hides and the "Sorting…" indicator shows until refresh).
  function markWaitingClassifying() {
    setThreads((prev) =>
      prev.map((t) => (isWaiting(t) ? { ...t, isClassifying: true } : t))
    );
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const filteredThreads = filterThreads(threads, folders, active, "all", query);
  const filteredIds = filteredThreads.map((t) => t.id);

  const selectedThread = selectedId
    ? threads.find((t) => t.id === selectedId) ?? null
    : null;

  const anyClassifying = threads.some((t) => t.isClassifying);

  // Threads waiting to be routed: not yet sorted and not actively classifying.
  // These are routed only on an explicit "Route now" click, never automatically.
  const isWaiting = (t: ThreadItem) =>
    !t.isClassifying && (t.status === "unsorted" || t.status === "unrouted");
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
