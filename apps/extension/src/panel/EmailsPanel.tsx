import { useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, FilterCounts, SyncStatus } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { ThreadList, ReroutePopover } from "@amarnai/ui/emails";
import { useEmailTriage } from "@amarnai/core/emails";
import { useWorkspaceEvents } from "../realtime/useWorkspaceEvents";
import { ThreadPreviewPane } from "./ThreadPreviewPane";
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

  useEffect(() => { loadFolderCounts(); }, [loadFolderCounts]);

  // Refresh the list + sync status + folder counts when the worker finishes a sync.
  useWorkspaceEvents(api, workspaceId, () => {
    void triage.refresh();
    api.syncStatus(workspaceId).then(setSyncStatus).catch(() => {});
    loadFolderCounts();
  });

  const [mobileView, setMobileView] = useState<"list" | "preview">("list");
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);

  const { active, selectedId, selectedThread, folders, toast } = triage;
  const routableNodeCount = folders.length;

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
      {/* Hidden while the preview pane covers the list (≤640px layout): the
          scope describes the thread list, and the preview has its own header. */}
      {mobileView === "list" && (
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
    </div>
  );
}
