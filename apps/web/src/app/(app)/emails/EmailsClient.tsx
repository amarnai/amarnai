"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SyncStatus } from "@/lib/api";
import type { ActiveSelection, FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { filterThreads, EmailRail, ThreadList, ReroutePopover } from "@amarnai/ui/emails";
import { ThreadPreview } from "./ThreadPreview";
import { useThreadKeyboard } from "./useThreadKeyboard";
import { mapThreads } from "./queries";

type RerouteTarget = { kind: "single"; threadId: string } | null;

type Toast = { message: string; onUndo?: () => void };

// Merge a fresh server thread list into local state without clobbering
// in-progress draft state. Two races can occur if we blindly replace:
//   1. The server may not yet have committed a GENERATING placeholder when
//      ClassifyingRefresher fires, so it returns isDrafting:false even though
//      the client already set it to true — discarding the loading indicator.
//   2. The selected thread may fall outside the first-page window (>50 threads),
//      causing selectedThread to become null, which unmounts ThreadPreview and
//      loses the draftState React state.
// The merge preserves local isDrafting/hasDraft until the server confirms the
// final state, and re-inserts the selected thread if the server dropped it.
function mergeThreads(fresh: ThreadItem[], prev: ThreadItem[], pinnedId: string | null): ThreadItem[] {
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  const merged = fresh.map((t) => {
    const existing = prevMap.get(t.id);
    if (!existing) return t;
    // Keep isDrafting true until the server confirms the draft is proposed
    // (hasDraft:true means PROPOSED is in the DB, so drafting is over).
    const isDrafting = (t.isDrafting || existing.isDrafting) && !t.hasDraft;
    const hasDraft = t.hasDraft || existing.hasDraft;
    return { ...t, isDrafting, hasDraft };
  });
  // Re-insert the selected thread if the server omitted it (pagination drop).
  if (pinnedId && !merged.some((t) => t.id === pinnedId)) {
    const pinned = prevMap.get(pinnedId);
    if (pinned) merged.push(pinned);
  }
  return merged;
}

type Props = {
  workspaceId: string;
  currentUserId: string;
  initialThreads: ThreadItem[];
  initialFolders: FolderItem[];
  initialActive: ActiveSelection;
  initialSelectedId: string | null;
  syncStatus: SyncStatus;
  workspaceEmail: string | null;
};

export function EmailsClient({
  workspaceId,
  currentUserId,
  initialThreads,
  initialFolders,
  initialActive,
  initialSelectedId,
  syncStatus,
  workspaceEmail,
}: Props) {
  const router = useRouter();
  const now = useRef(new Date()).current;

  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  const [folders] = useState<FolderItem[]>(initialFolders);

  const [active, setActive] = useState<ActiveSelection>(initialActive);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  // Always-current ref so async callbacks (SSE, fetch) can read the latest
  // selectedId without being added to useEffect deps (which would reconnect
  // the EventSource on every thread selection).
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Sync server-rendered threads into local state after router.refresh() — e.g.
  // when ClassifyingRefresher fires.
  useEffect(() => {
    setThreads((prev) => mergeThreads(initialThreads, prev, selectedIdRef.current));
  }, [initialThreads]);

  // Connect to the workspace SSE stream; refresh the thread list immediately
  // when the sync-inbox worker finishes, without a full page reload.
  useEffect(() => {
    const es = new EventSource(
      `/api/workspace-events?workspaceId=${encodeURIComponent(workspaceId)}`
    );
    es.addEventListener("synced", () => {
      api.emailThreads(workspaceId).then(({ threads: fresh }) => {
        setThreads((prev) => mergeThreads(mapThreads(fresh), prev, selectedIdRef.current));
      }).catch(() => {});
    });
    es.onerror = () => {};
    return () => es.close();
  }, [workspaceId]);

  const [mobileView, setMobileView] = useState<"list" | "preview">(
    initialSelectedId ? "preview" : "list"
  );
  const [railOpen, setRailOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [railQuery, setRailQuery] = useState("");
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const [rerouteTarget, setRerouteTarget] = useState<RerouteTarget>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredThreads = filterThreads(threads, folders, active, "all", query);
  const filteredIds = filteredThreads.map((t) => t.id);

  const selectedThread = selectedId
    ? threads.find((t) => t.id === selectedId) ?? null
    : null;

  function pushActive(a: ActiveSelection) {
    setActive(a);
    setSelectedId(null);
    setMobileView("list");
    setRailOpen(false);
    setQuery("");
    const param = a.kind === "queue" ? `?q=${a.id}` : `?f=${a.id}`;
    router.replace(`/emails${param}`, { scroll: false });
  }

  function selectThread(id: string) {
    setSelectedId(id);
    setMobileView("preview");
    const a = active.kind === "queue"
      ? `?q=${active.id}&t=${id}`
      : `?f=${active.id}&t=${id}`;
    router.replace(`/emails${a}`, { scroll: false });
  }

  function closePreview() {
    setSelectedId(null);
    setMobileView("list");
  }

  function toggleFolder(id: string) {
    setOpenFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ─── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg: Toast) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function dismissToast() {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }

  // ─── Approve ────────────────────────────────────────────────────────────────

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

  // ─── Mark done ──────────────────────────────────────────────────────────────

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

  // ─── Reroute ────────────────────────────────────────────────────────────────

  function openRerouteFor(threadId: string, anchor: HTMLElement) {
    setRerouteTarget({ kind: "single", threadId });
    setRerouteAnchor(anchor);
  }

  function closeReroute() {
    setRerouteAnchor(null);
    setRerouteTarget(null);
  }

  function commitReroute(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    const folderName = folder?.name ?? "folder";
    setRerouteAnchor(null);

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

  // ─── Draft generated ────────────────────────────────────────────────────────

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

  // ─── New folder ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function handle() {
      router.push("/taxonomy");
    }
    document.addEventListener("emails:new-folder", handle);
    return () => document.removeEventListener("emails:new-folder", handle);
  }, [router]);

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  const handleRerouteKey = useCallback(() => {
    if (!selectedId) return;
    const anchor = document.querySelector<HTMLElement>(".em-rationale-actions .em-btn-secondary");
    if (anchor) openRerouteFor(selectedId, anchor);
  }, [selectedId]);

  useThreadKeyboard({
    threadIds: filteredIds,
    selectedId,
    popoverOpen: rerouteAnchor !== null,
    onNavigate: selectThread,
    onToggleCheck: () => {},
    onApprove: handleApprove,
    onReroute: handleRerouteKey,
    onFocusSearch: () => searchRef.current?.focus(),
  });

  const syncInfo = syncStatus
    ? {
        lastSyncedAt: syncStatus.lastSyncedAt,
        backfillStatus: syncStatus.backfillStatus === "RUNNING" ? ("RUNNING" as const) : ("IDLE" as const),
        workspacePlan: syncStatus.workspacePlan,
        pushEnabled: syncStatus.pushEnabled,
      }
    : null;

  return (
    <div
      className="em-grid"
      data-mobile-view={mobileView}
      data-rail-open={String(railOpen)}
      suppressHydrationWarning
    >
      <EmailRail
        threads={threads}
        folders={folders}
        active={active}
        railQuery={railQuery}
        openFolderIds={openFolderIds}
        syncInfo={syncInfo}
        onSelectActive={pushActive}
        onRailQueryChange={setRailQuery}
        onToggleFolder={toggleFolder}
        onNewFolder={() => router.push("/taxonomy")}
        upgradeHref="/upgrade"
      />

      <ThreadList
        threads={threads}
        folders={folders}
        active={active}
        selectedId={selectedId}
        query={query}
        now={now}
        workspaceEmail={workspaceEmail}
        onSelectThread={selectThread}
        onSelectFolder={(id) => pushActive({ kind: "folder", id })}
        onQueryChange={setQuery}
        searchRef={searchRef}
        onMarkDone={handleMarkDone}
        onUnmarkDone={handleUnmarkDone}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
      />

      {selectedThread ? (
        <ThreadPreview
          thread={selectedThread}
          folders={folders}
          workspaceId={workspaceId}
          onApprove={handleApprove}
          onReroute={openRerouteFor}
          onClose={closePreview}
          workspaceEmail={workspaceEmail}
          onDraftStarted={handleDraftStarted}
          onDraftFailed={handleDraftFailed}
          onDraftGenerated={handleDraftGenerated}
          onDraftSentToggled={handleDraftSentToggled}
          onMarkDone={handleMarkDone}
          onUnmarkDone={handleUnmarkDone}
        />
      ) : (
        <div className="em-preview-empty">
          <span>Select a thread to preview</span>
        </div>
      )}

      <ReroutePopover
        folders={folders}
        anchor={rerouteAnchor}
        onCommit={commitReroute}
        onClose={closeReroute}
      />

      {toast && (
        <div className="em-toast">
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              type="button"
              onClick={() => {
                toast.onUndo?.();
                dismissToast();
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="em-toast-close" onClick={dismissToast} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
