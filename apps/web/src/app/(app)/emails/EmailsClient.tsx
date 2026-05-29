"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SyncStatus } from "@/lib/api";
import type { ActiveSelection, FolderItem, ThreadItem } from "./selection";
import { filterThreads } from "./selection";
import { Rail } from "./Rail";
import { ThreadList } from "./ThreadList";
import { ThreadPreview } from "./ThreadPreview";
import { ReroutePopover } from "./ReroutePopover";
import { useThreadKeyboard } from "./useThreadKeyboard";

type RerouteTarget = { kind: "single"; threadId: string } | null;

type Toast = { message: string; onUndo?: () => void };

type Props = {
  workspaceId: string;
  initialThreads: ThreadItem[];
  initialFolders: FolderItem[];
  initialActive: ActiveSelection;
  initialSelectedId: string | null;
  syncStatus: SyncStatus;
  workspaceEmail: string | null;
};

export function EmailsClient({
  workspaceId,
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
  const [query, setQuery] = useState("");
  const [railQuery, setRailQuery] = useState("");
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const [rerouteTarget, setRerouteTarget] = useState<RerouteTarget>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredThreads = filterThreads(threads, folders, active, "all", query, now);
  const filteredIds = filteredThreads.map((t) => t.id);

  const selectedThread = selectedId
    ? threads.find((t) => t.id === selectedId) ?? null
    : null;

  function pushActive(a: ActiveSelection) {
    setActive(a);
    setSelectedId(null);
    setQuery("");
    const param = a.kind === "queue" ? `?q=${a.id}` : `?f=${a.id}`;
    router.replace(`/emails${param}`, { scroll: false });
  }

  function selectThread(id: string) {
    setSelectedId(id);
    const a = active.kind === "queue"
      ? `?q=${active.id}&t=${id}`
      : `?f=${active.id}&t=${id}`;
    router.replace(`/emails${a}`, { scroll: false });
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

  return (
    <div className="em-grid" suppressHydrationWarning>
      <Rail
        threads={threads}
        folders={folders}
        active={active}
        railQuery={railQuery}
        openFolderIds={openFolderIds}
        syncStatus={syncStatus}
        now={now}
        onSelectActive={pushActive}
        onRailQueryChange={setRailQuery}
        onToggleFolder={toggleFolder}
        onNewFolder={() => router.push("/taxonomy")}
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
      />

      {selectedThread ? (
        <ThreadPreview
          thread={selectedThread}
          folders={folders}
          workspaceId={workspaceId}
          onApprove={handleApprove}
          onReroute={openRerouteFor}
          onClose={() => setSelectedId(null)}
          workspaceEmail={workspaceEmail}
          onDraftStarted={handleDraftStarted}
          onDraftFailed={handleDraftFailed}
          onDraftGenerated={handleDraftGenerated}
          onDraftSentToggled={handleDraftSentToggled}
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
