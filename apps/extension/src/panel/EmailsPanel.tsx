import { useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, FilterCounts, SyncStatus } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { ThreadList, ReroutePopover } from "@amarnai/ui/emails";
import { useEmailTriage, resolveInboxStatus, mapFolders } from "@amarnai/core/emails";
import { useWorkspaceEvents } from "../realtime/useWorkspaceEvents";
import { ThreadPreviewPane } from "./ThreadPreviewPane";
import { StatusSlot, NoPlanEmptyState } from "./StatusSlot";
import { PanelHeader } from "./WorkspacePicker";
import { ScopeField } from "./ScopeField";
import { openThreadInMail } from "../gmail/openInGmail";

type Props = {
  api: ApiClient;
  workspaceId: string;
  currentUserId: string;
  initialThreads: ThreadItem[];
  initialNextCursor: string | null;
  initialCounts: FilterCounts;
  initialFilteredTotal: number;
  initialFolders: FolderItem[];
  initialSyncStatus: SyncStatus | null;
  workspaceEmail: string | null;
  gmailAddress: string | null;
};

// Recomposition of apps/web EmailsClient for the side panel: the shared
// useEmailTriage view-model drives the same @amarnai/ui components, but without
// Next routing or keyboard nav. The web app stacks its sorting-status banners;
// at 360px the panel collapses them into one pinned StatusSlot whose state is
// picked by the shared resolveInboxStatus. The panel owns the SSE stream (via
// useWorkspaceEvents) and reuses the ≤640px "mobile" layout baked into
// emails.css (list <-> preview switching via data-mobile-view).
export function EmailsPanel({
  api,
  workspaceId,
  currentUserId,
  initialThreads,
  initialNextCursor,
  initialCounts,
  initialFilteredTotal,
  initialFolders,
  initialSyncStatus,
  workspaceEmail,
  gmailAddress,
}: Props) {
  const { _ } = useLingui();
  const now = useRef(new Date()).current;
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(initialSyncStatus);
  // Per-folder thread totals for the ScopeField picker rows, server-computed so
  // they reflect the whole workspace rather than the loaded page. Keyed by
  // taxonomy node id.
  const [folderCounts, setFolderCounts] = useState<Map<string, number>>(new Map());

  const loadFolderCounts = useCallback(() => {
    api
      .folderCounts(workspaceId)
      .then((r) => setFolderCounts(new Map(r.counts.map((c) => [c.nodeId, c.count]))))
      .catch(() => {});
  }, [api, workspaceId]);

  const triage = useEmailTriage({
    api,
    workspaceId,
    currentUserId,
    initialThreads,
    initialNextCursor,
    initialCounts,
    initialFilteredTotal,
    initialFolders,
    initialActive: { kind: "queue", id: "all" } as ActiveSelection,
    initialSelectedId: null,
  });

  // Re-fetch the taxonomy and refresh the folder list. The panel's seed is
  // loaded once (TriageGate) and, unlike the web app, is never re-seeded by a
  // server navigation — so a plan built in the web app (reached via the "Set up
  // folders" link) would otherwise never reach the panel, and the no-plan banner
  // would never flip to "Sort". Triggered on focus/visibility and on each sync.
  const reloadTaxonomy = useCallback(() => {
    Promise.all([api.taxonomyNodes(workspaceId), api.taxonomyEdges(workspaceId)])
      .then(([nodes, edges]) => triage.syncFolders(mapFolders(nodes, edges)))
      .catch(() => {});
  }, [api, workspaceId, triage.syncFolders]);

  useEffect(() => { loadFolderCounts(); }, [loadFolderCounts]);

  // The plan is edited in a separate web tab; re-pull the taxonomy (and folder
  // counts) when the panel regains focus so the banner reflects the new folders.
  useEffect(() => {
    function onFocus() {
      if (document.visibilityState === "visible") {
        reloadTaxonomy();
        loadFolderCounts();
      }
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [reloadTaxonomy, loadFolderCounts]);

  // Refresh the list + sync status + taxonomy + folder counts when the worker
  // finishes a sync.
  useWorkspaceEvents(api, workspaceId, () => {
    void triage.refresh();
    api.syncStatus(workspaceId).then(setSyncStatus).catch(() => {});
    reloadTaxonomy();
    loadFolderCounts();
  });

  const [mobileView, setMobileView] = useState<"list" | "preview">("list");
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  // Plan-cap notice is dismissible for the session; kept here (not in StatusSlot)
  // so it survives the list <-> preview view switch and feeds the resolver.
  const [planCapDismissed, setPlanCapDismissed] = useState(false);

  const { active, selectedId, selectedThread, folders, toast } = triage;
  const routableNodeCount = folders.length;

  // The single sorting-status state to surface (or null). Shared with web via
  // @amarnai/core; the panel renders the empty case full-pane and the rest as
  // one pinned row.
  const inboxStatus = resolveInboxStatus({
    waitingCount: triage.serverWaitingCount,
    routableNodeCount,
    threadCount: triage.total,
    backfillStatus: syncStatus?.backfillStatus ?? "DONE",
    backfillRoutingStarted: syncStatus?.backfillRoutingStarted ?? false,
    backfillLimitState: syncStatus?.backfillLimitState ?? "NONE",
    backfillAwaitingTaxonomy: syncStatus?.backfillAwaitingTaxonomy ?? false,
    workspacePlan: syncStatus?.workspacePlan ?? "FREE",
    planCapDismissed,
  });

  // Route the whole waiting backlog. Optimistically zero the waiting counts so
  // the CTA hides at once; the sweep result lands via the SSE refresh.
  function handleSort() {
    triage.markWaitingClassifying();
    api.routeUnrouted(workspaceId).catch(() => {});
  }

  function pushActive(a: ActiveSelection) {
    triage.setActive(a);
    triage.setSelectedId(null);
    setMobileView("list");
    triage.setQuery("");
  }

  function selectThread(id: string) {
    triage.setSelectedId(id);
    setMobileView("preview");
  }

  function closePreview() {
    triage.setSelectedId(null);
    setMobileView("list");
  }

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

  return (
    <div className="ax-panel">
      <PanelHeader />
      {inboxStatus?.kind === "no-plan-empty" ? (
        // Nothing to list and no plan yet: the whole pane becomes one CTA into
        // the web plan editor rather than a banner over an empty list.
        <NoPlanEmptyState />
      ) : (
      <>
      {/* Slot + scope are hidden while the preview pane covers the list (≤640px
          layout): the scope describes the thread list, and the preview has its
          own header. The status slot belongs to the list view. */}
      {mobileView === "list" && (
        <>
          <StatusSlot
            status={inboxStatus}
            onSort={handleSort}
            onDismissPlanCap={() => setPlanCapDismissed(true)}
          />
          <ScopeField
            folders={folders}
            active={active}
            total={triage.filteredTotal}
            allCount={triage.total}
            folderCounts={folderCounts}
            query={triage.query}
            onQueryChange={triage.setQuery}
            onSelect={pushActive}
          />
        </>
      )}
      <div
        className="em-grid"
        data-mobile-view={mobileView}
      >
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
          showHeader={false}
          onMarkDone={triage.handleMarkDone}
          onUnmarkDone={triage.handleUnmarkDone}
          onToggleImportant={triage.handleToggleImportant}
          {...(gmailAddress
            ? {
                onOpenInGmail: (threadId: string) => {
                  const t = triage.threads.find((x) => x.id === threadId);
                  if (t) void openThreadInMail(gmailAddress, t);
                },
              }
            : {})}
          hasMore={triage.hasMore}
          loadingMore={triage.loadingMore}
          onLoadMore={triage.loadMore}
          total={triage.filteredTotal}
          backfilling={syncStatus?.backfillStatus === "RUNNING"}
        />

        {selectedThread ? (
          <ThreadPreviewPane
            api={api}
            thread={selectedThread}
            folders={folders}
            workspaceId={workspaceId}
            workspaceEmail={workspaceEmail}
            gmailAddress={gmailAddress}
            routableNodeCount={routableNodeCount}
            onApprove={triage.handleApprove}
            onReroute={openRerouteFor}
            onClose={closePreview}
            onDraftStarted={triage.handleDraftStarted}
            onDraftFailed={triage.handleDraftFailed}
            onDraftGenerated={triage.handleDraftGenerated}
            onDraftSentToggled={triage.handleDraftSentToggled}
            onMarkDone={triage.handleMarkDone}
            onUnmarkDone={triage.handleUnmarkDone}
            onToggleImportant={triage.handleToggleImportant}
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
            <button
              type="button"
              className="em-toast-close"
              onClick={triage.dismissToast}
              aria-label={_(msg`Dismiss`)}
            >
              ×
            </button>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
