"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SyncStatus } from "@/lib/api";
import type { ActiveSelection, FolderItem, ThreadItem } from "@amarnai/ui/emails";
import type { FilterCounts } from "@amarnai/api-client";
import { EmailRail, ThreadList, ReroutePopover } from "@amarnai/ui/emails";
import { useEmailTriage } from "@amarnai/core/emails";
import { ThreadPreview } from "./ThreadPreview";
import { useThreadKeyboard } from "./useThreadKeyboard";
import { UnroutedBanner } from "./UnroutedBanner";
import { PlanCapBanner } from "./PlanCapBanner";
import { ClassifyingRefresher } from "@/components/ClassifyingRefresher";

type Props = {
  workspaceId: string;
  currentUserId: string;
  initialThreads: ThreadItem[];
  initialNextCursor: string | null;
  initialCounts: FilterCounts | undefined;
  initialFilteredTotal: number;
  initialFolders: FolderItem[];
  initialActive: ActiveSelection;
  initialSelectedId: string | null;
  syncStatus: SyncStatus;
  workspaceEmail: string | null;
  routableNodeCount: number;
  unclassifiedCount: number;
};

export function EmailsClient({
  workspaceId,
  currentUserId,
  initialThreads,
  initialNextCursor,
  initialCounts,
  initialFilteredTotal,
  initialFolders,
  initialActive,
  initialSelectedId,
  syncStatus,
  workspaceEmail,
  routableNodeCount,
  unclassifiedCount,
}: Props) {
  const router = useRouter();
  const now = useRef(new Date()).current;

  // Shared, platform-agnostic triage view-model (thread data, selection,
  // optimistic mutations, toast). This component owns only the web-specific
  // wiring around it: Next routing, the SSE refresh stream, layout state, the
  // DOM reroute anchor, keyboard nav, and the JSX.
  const triage = useEmailTriage({
    api,
    workspaceId,
    currentUserId,
    initialThreads,
    initialNextCursor,
    initialCounts,
    initialFilteredTotal,
    initialFolders,
    initialActive,
    initialSelectedId,
  });

  // The view-model owns list fetching (it re-fetches on view/search change), so
  // there is no longer an initialThreads→state sync here — that would merge the
  // server-rendered default view back over the active one.

  // Connect to the workspace SSE stream; refresh the thread list immediately
  // when the sync-inbox worker finishes, without a full page reload.
  useEffect(() => {
    const es = new EventSource(
      `/api/workspace-events?workspaceId=${encodeURIComponent(workspaceId)}`
    );
    es.addEventListener("synced", () => {
      triage.refresh();
    });
    es.onerror = () => {};
    return () => es.close();
  }, [workspaceId]);

  const [mobileView, setMobileView] = useState<"list" | "preview">(
    initialSelectedId ? "preview" : "list"
  );
  const [railOpen, setRailOpen] = useState(true);
  const [railQuery, setRailQuery] = useState("");
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { active, selectedId, selectedThread, folders, toast } = triage;

  function pushActive(a: ActiveSelection) {
    triage.setActive(a);
    triage.setSelectedId(null);
    setMobileView("list");
    setRailOpen(false);
    triage.setQuery("");
    const param = a.kind === "queue" ? `?q=${a.id}` : `?f=${a.id}`;
    router.replace(`/emails${param}`, { scroll: false });
  }

  function selectThread(id: string) {
    triage.setSelectedId(id);
    setMobileView("preview");
    const a = active.kind === "queue"
      ? `?q=${active.id}&t=${id}`
      : `?f=${active.id}&t=${id}`;
    router.replace(`/emails${a}`, { scroll: false });
  }

  function closePreview() {
    triage.setSelectedId(null);
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

  // ─── Reroute (DOM anchor lives here; target + commit logic lives in the hook) ─

  function openRerouteFor(threadId: string, anchor: HTMLElement) {
    triage.openRerouteFor(threadId);
    setRerouteAnchor(anchor);
  }

  function closeReroute() {
    setRerouteAnchor(null);
    triage.closeReroute();
  }

  function commitReroute(folderId: string) {
    setRerouteAnchor(null);
    triage.commitReroute(folderId);
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
    threadIds: triage.filteredIds,
    selectedId,
    popoverOpen: rerouteAnchor !== null,
    onNavigate: selectThread,
    onToggleCheck: () => {},
    onApprove: triage.handleApprove,
    onReroute: handleRerouteKey,
    onFocusSearch: () => searchRef.current?.focus(),
  });

  const syncInfo = syncStatus
    ? {
        lastSyncedAt: syncStatus.lastSyncedAt,
        backfillStatus: syncStatus.backfillStatus === "RUNNING" ? ("RUNNING" as const) : ("IDLE" as const),
        backfillProcessedCount: syncStatus.backfillProcessedCount,
        backfillTotal: syncStatus.backfillTotal,
        backfillAwaitingTaxonomy: syncStatus.backfillAwaitingTaxonomy,
        workspacePlan: syncStatus.workspacePlan,
        pushEnabled: syncStatus.pushEnabled,
      }
    : null;

  return (
    <>
    <ClassifyingRefresher active={triage.anyClassifying} onPoll={triage.refresh} />
    <UnroutedBanner
      workspaceId={workspaceId}
      waitingCount={triage.serverWaitingCount}
      routableNodeCount={routableNodeCount}
      onRouted={triage.markWaitingClassifying}
    />
    <PlanCapBanner syncStatus={syncStatus} />
    <div
      className="em-grid"
      data-mobile-view={mobileView}
      data-rail-open={String(railOpen)}
      suppressHydrationWarning
    >
      <EmailRail
        threads={triage.threads}
        folders={folders}
        active={active}
        railQuery={railQuery}
        openFolderIds={openFolderIds}
        queueCounts={triage.queueCounts}
        syncInfo={syncInfo}
        onSelectActive={pushActive}
        onRailQueryChange={setRailQuery}
        onToggleFolder={toggleFolder}
        onNewFolder={() => router.push("/taxonomy")}
        upgradeHref="/upgrade"
      />

      <ThreadList
        threads={triage.threads}
        folders={folders}
        active={active}
        selectedId={selectedId}
        query={triage.query}
        now={now}
        workspaceEmail={workspaceEmail}
        onSelectThread={selectThread}
        onSelectFolder={(id) => pushActive({ kind: "folder", id })}
        onQueryChange={triage.setQuery}
        searchRef={searchRef}
        onMarkDone={triage.handleMarkDone}
        onUnmarkDone={triage.handleUnmarkDone}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        hasMore={triage.hasMore}
        loadingMore={triage.loadingMore}
        onLoadMore={triage.loadMore}
        total={triage.filteredTotal}
      />

      {selectedThread ? (
        <ThreadPreview
          thread={selectedThread}
          folders={folders}
          workspaceId={workspaceId}
          routableNodeCount={routableNodeCount}
          onApprove={triage.handleApprove}
          onReroute={openRerouteFor}
          onClose={closePreview}
          workspaceEmail={workspaceEmail}
          onDraftStarted={triage.handleDraftStarted}
          onDraftFailed={triage.handleDraftFailed}
          onDraftGenerated={triage.handleDraftGenerated}
          onDraftSentToggled={triage.handleDraftSentToggled}
          onMarkDone={triage.handleMarkDone}
          onUnmarkDone={triage.handleUnmarkDone}
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
                triage.dismissToast();
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="em-toast-close" onClick={triage.dismissToast} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>

    {unclassifiedCount > 0 && (
      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 100 }}>
        <button type="button" className="btn-secondary" onClick={triage.handleReroute}>
          Re-route {unclassifiedCount} unclassified
        </button>
      </div>
    )}
    </>
  );
}
