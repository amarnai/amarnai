"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { api } from "@/lib/api";
import type { SyncStatus } from "@/lib/api";
import type { ActiveSelection, FolderItem, ThreadItem, MemberItem } from "@amarnai/ui/emails";
import type { FilterCounts } from "@amarnai/api-client";
import { ColumnResizeHandle, EmailRail, ThreadList, ReroutePopover, AssigneePicker } from "@amarnai/ui/emails";
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
  members: MemberItem[];
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
  syncStatus: initialSyncStatus,
  workspaceEmail,
  routableNodeCount,
  unclassifiedCount,
  members,
}: Props) {
  const router = useRouter();
  const { _ } = useLingui();
  const now = useRef(new Date()).current;

  // Sync status (backfill progress, counts) starts from the server-rendered
  // snapshot and is refreshed live off the SSE stream below.
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initialSyncStatus);

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
      // Backfill emits this per batch and on completion, so re-pull the sync
      // status to keep the backfill card's counts/progress current.
      api.syncStatus(workspaceId).then(setSyncStatus).catch(() => {});
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
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  const [assignThreadId, setAssignThreadId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Assign is offered only when there is at least one other member to hand a
  // thread to — i.e. the workspace has ≥2 members total.
  const canAssign = members.length >= 2;

  const { active, selectedId, selectedThread, folders, toast } = triage;

  // Open a thread's preview when the URL carries a `?t=` param. This covers deep
  // links from outside the page — e.g. clicking a thread-assignment notification
  // in the bell pop-up. Such a click is a soft navigation that updates the search
  // params without remounting this client, so the selection must be synced here
  // rather than only from the initial server props. The thread is fetched on
  // demand when it isn't already in the loaded list, so the preview opens even
  // for threads outside the current view or page.
  const searchParams = useSearchParams();
  const tParam = searchParams.get("t");
  useEffect(() => {
    if (!tParam) return;
    if (tParam !== triage.selectedId) {
      triage.setSelectedId(tParam);
      setMobileView("preview");
    }
    void triage.loadThread(tParam);
    // Keyed on the target thread only; in-list taps already keep selection and
    // URL in sync via selectThread, and triage's setters/loadThread are stable.
  }, [tParam]);

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
    // Drop the `?t=` param so a refresh (or the deep-link effect above) does not
    // reopen a preview the user just closed.
    const param = active.kind === "queue" ? `?q=${active.id}` : `?f=${active.id}`;
    router.replace(`/emails${param}`, { scroll: false });
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

  // ─── Assign (DOM anchor + target thread live here; commit goes to the hook) ───

  function openAssignFor(threadId: string, anchor: HTMLElement) {
    setAssignThreadId(threadId);
    setAssignAnchor(anchor);
  }

  function closeAssign() {
    setAssignAnchor(null);
    setAssignThreadId(null);
  }

  function commitAssign(userId: string | null) {
    if (assignThreadId) {
      const member = userId ? members.find((m) => m.userId === userId) ?? null : null;
      triage.handleAssign(assignThreadId, member);
    }
    closeAssign();
  }

  const assignThread = assignThreadId
    ? triage.threads.find((t) => t.id === assignThreadId) ?? null
    : null;

  // ─── New folder ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function handle() {
      router.push("/plan");
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
        backfillLoadedThreads: syncStatus.backfillLoadedThreads,
        backfillTotalThreads: syncStatus.backfillTotalThreads,
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
      routingStarted={syncStatus?.backfillRoutingStarted ?? false}
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
        onNewFolder={() => router.push("/plan")}
      />
      <ColumnResizeHandle column="rail" />

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
        canAssign={canAssign}
        onOpenAssign={openAssignFor}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        hasMore={triage.hasMore}
        loadingMore={triage.loadingMore}
        onLoadMore={triage.loadMore}
        total={triage.filteredTotal}
        backfilling={syncStatus?.backfillStatus === "RUNNING"}
      />
      <ColumnResizeHandle column="list" />

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
          members={members}
          canAssign={canAssign}
          onOpenAssign={openAssignFor}
        />
      ) : (
        <div className="em-preview-empty">
          <span><Trans>Select a thread to preview</Trans></span>
        </div>
      )}

      <ReroutePopover
        folders={folders}
        anchor={rerouteAnchor}
        onCommit={commitReroute}
        onClose={closeReroute}
      />

      <AssigneePicker
        members={members}
        assignedUserId={assignThread?.assignment?.userId ?? null}
        anchor={assignAnchor}
        onCommit={commitAssign}
        onClose={closeAssign}
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
              <Trans>Undo</Trans>
            </button>
          )}
          <button type="button" className="em-toast-close" onClick={triage.dismissToast} aria-label={_(msg`Dismiss`)}>
            ×
          </button>
        </div>
      )}
    </div>

    {unclassifiedCount > 0 && (
      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 100 }}>
        <button type="button" className="btn-secondary" onClick={triage.handleReroute}>
          <Trans>Re-route {unclassifiedCount} unclassified</Trans>
        </button>
      </div>
    )}
    </>
  );
}
