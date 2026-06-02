"use client";

import { useRef, useState } from "react";
import type { FolderItem } from "../folder-tree/types.js";
import type { ActiveSelection, ThreadItem, DraftItem, SyncInfo } from "./types.js";
import { filterThreads } from "./selection.js";
import { EmailRail } from "./EmailRail.js";
import { ThreadList } from "./ThreadList.js";
import { ThreadPreview } from "./ThreadPreview.js";
import { ReroutePopover } from "./ReroutePopover.js";

type Toast = { message: string; onUndo?: () => void };

export interface MockEmailsPageProps {
  initialThreads: ThreadItem[];
  initialFolders: FolderItem[];
  initialActive?: ActiveSelection;
  initialSelectedId?: string | null;
  syncInfo?: SyncInfo;
  workspaceEmail?: string | null;
  upgradeHref?: string;
  /** Maps thread id → pre-written draft body for mock generation. */
  draftBodies?: Record<string, string>;
}

export function MockEmailsPage({
  initialThreads,
  initialFolders,
  initialActive = { kind: "queue", id: "all" },
  initialSelectedId = null,
  syncInfo = null,
  workspaceEmail,
  upgradeHref,
  draftBodies,
}: MockEmailsPageProps) {
  const now = useRef(new Date()).current;

  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  const [folders] = useState<FolderItem[]>(initialFolders);
  const [active, setActive] = useState<ActiveSelection>(initialActive);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [mobileView, setMobileView] = useState<"list" | "preview">(
    initialSelectedId ? "preview" : "list"
  );
  const [railOpen, setRailOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [railQuery, setRailQuery] = useState("");
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const [rerouteThreadId, setRerouteThreadId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [draftMap, setDraftMap] = useState<Map<string, DraftItem>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredThreads = filterThreads(threads, folders, active, "all", query);
  const selectedThread = selectedId ? threads.find((t) => t.id === selectedId) ?? null : null;

  function pushActive(a: ActiveSelection) {
    setActive(a);
    setSelectedId(null);
    setMobileView("list");
    setRailOpen(false);
    setQuery("");
  }

  function selectThread(id: string) {
    setSelectedId(id);
    setMobileView("preview");
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

  function showToast(msg: Toast) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function dismissToast() {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }

  function handleApprove(threadId: string) {
    setThreads((ts) => ts.map((t) => t.id === threadId ? { ...t, status: "sorted" as const } : t));
    showToast({ message: "Routing approved" });
  }

  function handleMarkDone(threadId: string) {
    setThreads((ts) =>
      ts.map((t) =>
        t.id === threadId
          ? { ...t, doneMark: { userId: "mock", userName: null, userEmail: "", resolvedAt: new Date().toISOString() } }
          : t,
      ),
    );
  }

  function handleUnmarkDone(threadId: string) {
    setThreads((ts) => ts.map((t) => t.id === threadId ? { ...t, doneMark: null } : t));
  }

  function openRerouteFor(threadId: string, anchor: HTMLElement) {
    setRerouteThreadId(threadId);
    setRerouteAnchor(anchor);
  }

  function closeReroute() {
    setRerouteAnchor(null);
    setRerouteThreadId(null);
  }

  function handleToggleDraftSent(threadId: string) {
    setDraftMap((m) => {
      const existing = m.get(threadId);
      if (!existing) return m;
      const next = new Map(m);
      next.set(threadId, { ...existing, status: existing.status === "SENT" ? "PROPOSED" : "SENT" });
      return next;
    });
  }

  function handleGenerateDraft(threadId: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const body = draftBodies?.[threadId] ?? "Thank you for your message. I'll follow up shortly.";
        setDraftMap((m) => {
          const next = new Map(m);
          next.set(threadId, { id: `draft-${threadId}`, subject: null, body, status: "PROPOSED" });
          return next;
        });
        setThreads((ts) => ts.map((t) => t.id === threadId ? { ...t, hasDraft: true, isDrafting: false } : t));
        resolve();
      }, 1000);
    });
  }

  function commitReroute(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    const folderName = folder?.name ?? "folder";
    setRerouteAnchor(null);
    if (!rerouteThreadId) return;
    const threadId = rerouteThreadId;
    const prev = threads.find((t) => t.id === threadId);
    setThreads((ts) =>
      ts.map((t) => t.id === threadId ? { ...t, folderId, status: "sorted" as const } : t),
    );
    if (prev) {
      showToast({
        message: `Moved to ${folderName}`,
        onUndo: () => {
          setThreads((ts) => ts.map((t) => (t.id === threadId ? prev : t)));
        },
      });
    }
    setRerouteThreadId(null);
  }

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
        now={now}
        onSelectActive={pushActive}
        onRailQueryChange={setRailQuery}
        onToggleFolder={toggleFolder}
        upgradeHref={upgradeHref}
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
          messages={selectedThread.messages}
          reasoning={selectedThread.reasoning}
          draft={draftMap.get(selectedThread.id) ?? null}
          workspaceEmail={workspaceEmail}
          onGenerateDraft={draftBodies ? () => handleGenerateDraft(selectedThread.id) : undefined}
          onToggleDraftSent={() => handleToggleDraftSent(selectedThread.id)}
          onApprove={handleApprove}
          onReroute={openRerouteFor}
          onClose={closePreview}
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
              onClick={() => { toast.onUndo?.(); dismissToast(); }}
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
