import { useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, FilterCounts, SyncStatus } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { ColumnResizeHandle, EmailRail, ThreadList, ReroutePopover } from "@amarnai/ui/emails";
import { useEmailTriage } from "@amarnai/core/emails";
import { useWorkspaceEvents } from "../realtime/useWorkspaceEvents";
import { ThreadPreviewPane } from "./ThreadPreviewPane";
import { PanelHeader } from "./WorkspacePicker";
import { openInGmail } from "../gmail/openInGmail";

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
// Next routing, keyboard nav, or the plan-cap/unrouted banners. The panel owns
// the SSE stream (via useWorkspaceEvents) and reuses the ≤640px "mobile" layout
// baked into emails.css (list <-> preview switching via data-mobile-view).
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

  // Refresh the list + sync status when the worker finishes a sync.
  useWorkspaceEvents(api, workspaceId, () => {
    void triage.refresh();
    api.syncStatus(workspaceId).then(setSyncStatus).catch(() => {});
  });

  const [mobileView, setMobileView] = useState<"list" | "preview">("list");
  const [railOpen, setRailOpen] = useState(false);
  const [railQuery, setRailQuery] = useState("");
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { active, selectedId, selectedThread, folders, toast } = triage;
  const routableNodeCount = folders.length;

  function pushActive(a: ActiveSelection) {
    triage.setActive(a);
    triage.setSelectedId(null);
    setMobileView("list");
    setRailOpen(false);
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

  function toggleFolder(id: string) {
    setOpenFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    <div className="ax-panel">
      <PanelHeader />
      <div
        className="em-grid"
        data-mobile-view={mobileView}
        data-rail-open={String(railOpen)}
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
          onToggleImportant={triage.handleToggleImportant}
          {...(gmailAddress
            ? {
                onOpenInGmail: (threadId: string) => {
                  const t = triage.threads.find((x) => x.id === threadId);
                  if (t) void openInGmail(gmailAddress, t.providerThreadId);
                },
              }
            : {})}
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
    </div>
  );
}
