import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ApiClient, FilterCounts, MailProvider, SyncStatus } from "@amarnai/api-client";
import type { ActiveSelection, FolderItem, ThreadItem } from "@amarnai/ui/emails";
import { ThreadList, ReroutePopover, AssigneePicker } from "@amarnai/ui/emails";
import type { PlanSetupMode } from "@amarnai/ui/plan-setup";
import { useEmailTriage, resolveInboxStatus, mapFolders, mapMembers } from "@amarnai/core/emails";
import { getCollaboratorLimit } from "@amarnai/shared";
import { useSession } from "../auth/session";
import { useWorkspaceEvents } from "../realtime/useWorkspaceEvents";
import { ThreadPreviewPane } from "./ThreadPreviewPane";
import { StatusSlot, NoPlanEmptyState } from "./StatusSlot";
import { PanelHeader } from "./WorkspacePicker";
import { ScopeField } from "./ScopeField";
import { openThreadInMail } from "../gmail/openInGmail";
import type { OutlookAccountType } from "@amarnai/core/emails";
import { openWebApp, openWebAppTab } from "./openWebApp";
import { focusMailTab, closeTab } from "../gmail/focusMailTab";
import { MASCOT_SRC } from "./assets";
import { startCheckout } from "../billing/api";
import { usePendingCheckout } from "../billing/usePendingCheckout";

// The dialog pulls in the taxonomy canvas (ReactFlow), which is far larger than
// the rest of the panel. Loaded on demand so users who already have a plan
// never pay for it.
const PlanSetupDialog = lazy(() =>
  import("@amarnai/ui/plan-setup").then((m) => ({ default: m.PlanSetupDialog })),
);

// Only ever opened from a quota-gated CTA, so most sessions never load it.
const UpgradeDialog = lazy(() =>
  import("@amarnai/ui/upgrade").then((m) => ({ default: m.UpgradeDialog })),
);

// Shares the ReactFlow canvas chunk with the plan-setup preview, so opening the
// editor after a plan has been set up costs almost nothing extra.
const TaxonomyEditorOverlay = lazy(() =>
  import("./TaxonomyEditorOverlay").then((m) => ({ default: m.TaxonomyEditorOverlay })),
);

const SettingsOverlay = lazy(() =>
  import("./SettingsOverlay").then((m) => ({ default: m.SettingsOverlay })),
);

// Shares the upgrade chunk with the plan picker.
const UpgradeSuccessOverlay = lazy(() =>
  import("./UpgradeSuccessOverlay").then((m) => ({ default: m.UpgradeSuccessOverlay })),
);

/**
 * How long to let the checkout tab settle on its success page before closing it.
 * Stripe completes the session fractionally before the browser finishes
 * navigating, so closing immediately can kill the tab mid-flight and leave the
 * user with nothing to have seen.
 */
const RETURN_TO_MAIL_DELAY_MS = 1500;


type Props = {
  api: ApiClient;
  workspaceId: string;
  currentUserId: string;
  /** The connected mailbox's provider, so detours can return the user to it. */
  provider: MailProvider;
  initialThreads: ThreadItem[];
  initialNextCursor: string | null;
  initialCounts: FilterCounts;
  initialFilteredTotal: number;
  initialFolders: FolderItem[];
  initialSyncStatus: SyncStatus | null;
  workspaceEmail: string | null;
  gmailAddress: string | null;
  /** Outlook only: personal vs work/school, which picks the Outlook web host. */
  outlookAccountType: OutlookAccountType | null;
  /** A sorting plan was created in-panel; re-seed from the new taxonomy. */
  onPlanApplied: () => void;
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
  provider,
  initialThreads,
  initialNextCursor,
  initialCounts,
  initialFilteredTotal,
  initialFolders,
  initialSyncStatus,
  workspaceEmail,
  gmailAddress,
  outlookAccountType,
  onPlanApplied,
}: Props) {
  const { _ } = useLingui();
  const now = useRef(new Date()).current;
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(initialSyncStatus);
  // Assignee candidates come from the session's workspace list (the workspaces
  // payload carries every member incl. the owner), so no members endpoint is
  // needed. refreshWorkspaces re-pulls them when the panel regains focus, the
  // same way the taxonomy is re-pulled after edits in a web tab.
  const { workspaces, refreshWorkspaces, switchWorkspace } = useSession();
  const workspaceName =
    workspaces.find((w) => w.id === workspaceId)?.name ?? "";
  const members = useMemo(
    () => mapMembers(workspaces.find((w) => w.id === workspaceId)?.members ?? []),
    [workspaces, workspaceId],
  );
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

  // A checkout the user was sent to a tab to complete. The hook polls until it
  // lands, so the new plan applies without waiting on Stripe's webhook and
  // without depending on this panel regaining focus.
  const pendingCheckout = usePendingCheckout({
    onProvisioned: useCallback((result: { plan: string; workspaceId: string }) => {
      api.syncStatus(workspaceId).then(setSyncStatus).catch(() => {});
      void refreshWorkspaces();
      setCheckoutSuccess(result);

      // Tidy up the detour: close the tab we sent the user to and put them back
      // in their mailbox, where the panel is docked and the new plan is already
      // in effect. Stripe marks the session complete just before the browser
      // finishes landing on the success page, so wait a beat rather than
      // yanking the tab away mid-navigation.
      const tabId = checkoutTabRef.current;
      checkoutTabRef.current = null;
      if (tabId == null) return;
      window.setTimeout(() => {
        void closeTab(tabId).then(() => focusMailTab(provider));
      }, RETURN_TO_MAIL_DELAY_MS);
    }, [api, workspaceId, refreshWorkspaces, provider]),
  });

  // The plan is edited in a separate web tab; re-pull the taxonomy (and folder
  // counts) when the panel regains focus so the banner reflects the new folders.
  useEffect(() => {
    function onFocus() {
      if (document.visibilityState === "visible") {
        reloadTaxonomy();
        loadFolderCounts();
        void refreshWorkspaces();
        void pendingCheckout.confirmNow();
      }
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [reloadTaxonomy, loadFolderCounts, refreshWorkspaces, pendingCheckout]);

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
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  const [assignThreadId, setAssignThreadId] = useState<string | null>(null);
  // Plan-cap notice is dismissible for the session; kept here (not in StatusSlot)
  // so it survives the list <-> preview view switch and feeds the resolver.
  const [planCapDismissed, setPlanCapDismissed] = useState(false);
  // Which branch the plan-setup dialog opened into, or null when it is closed.
  // Owned here because three different rows open it, and it must survive the
  // list <-> preview switch.
  const [planSetup, setPlanSetup] = useState<PlanSetupMode | null>(null);
  // The in-panel plan picker. Opened only from quota-gated CTAs, so a self-hosted
  // deployment (which never hits those) can never reach a billing screen.
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // The full folder editor. Opened from the header, so it is owned here
  // alongside the other full-panel overlays.
  const [editorOpen, setEditorOpen] = useState(false);
  // The tab the checkout was sent to, so it can be closed once the upgrade
  // lands rather than left behind on a page the user is done with.
  const checkoutTabRef = useRef<number | null>(null);
  // Success from a checkout that ran in a tab: the dialog closed when the user
  // left, so the outcome has nowhere to land unless the panel shows it here.
  const [checkoutSuccess, setCheckoutSuccess] = useState<{
    plan: string;
    workspaceId: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    // Clicking the same thread's folder chip again toggles the picker closed.
    if (triage.rerouteTarget?.threadId === threadId) {
      closeReroute();
      return;
    }
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

  // Assign is always offered, even in a single-member workspace, so solo users
  // discover the feature; the picker then surfaces an "Add members" CTA when
  // there is no one else to hand a thread to. Gate the upgrade badge on the
  // seat limit, not the plan name, so self-hosted deployments that allow
  // collaborators never see an upgrade prompt. (Mirrors apps/web EmailsClient.)
  const canAssign = true;
  const inviteNeedsUpgrade =
    syncStatus != null && getCollaboratorLimit(syncStatus.workspacePlan) === 0;

  // Stripe's success page is cookie-gated on the web app, so the checkout URL is
  // not opened directly: the sign-in bridge mints the web session on the way
  // through and /upgrade/resume forwards to Stripe. The session id is recorded
  // first so the result is confirmed even if the user never returns to that tab.
  const handleCheckoutStarted = useCallback(
    async ({ sessionId, url }: { sessionId: string; url: string }) => {
      await pendingCheckout.start(sessionId);
      setUpgradeOpen(false);
      checkoutTabRef.current = await openWebAppTab(
        api,
        `/upgrade/resume?session_id=${encodeURIComponent(sessionId)}`
      );
      // `url` is unused on this path: /upgrade/resume re-reads the session from
      // Stripe and redirects there, which also re-checks that it belongs to the
      // signed-in user. Kept in the callback shape so a host without a bridge
      // (the web app itself) can open it directly.
      void url;
    },
    [api, pendingCheckout]
  );

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

  return (
    <div className="ax-panel">
      <PanelHeader
        onOpenFolders={() => setEditorOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {inboxStatus?.kind === "no-plan-empty" ? (
        // Nothing to list and no plan yet: the whole pane becomes the plan-setup
        // entry point rather than a banner over an empty list.
        <NoPlanEmptyState onOpenPlanSetup={setPlanSetup} />
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
            onOpenPlanSetup={setPlanSetup}
            onOpenUpgrade={() => setUpgradeOpen(true)}
            upgradeAvailable={syncStatus?.billingEnabled ?? false}
          />
          <ScopeField
            folders={folders}
            active={active}
            total={triage.filteredTotal}
            allCount={triage.total}
            assignedCount={triage.queueCounts.assigned ?? 0}
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
          canAssign={canAssign}
          onOpenAssign={openAssignFor}
          onReroute={openRerouteFor}
          {...(gmailAddress
            ? {
                onOpenInGmail: (threadId: string) => {
                  const t = triage.threads.find((x) => x.id === threadId);
                  if (t) void openThreadInMail(gmailAddress, t, outlookAccountType);
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
            workspaceId={workspaceId}
            workspaceEmail={workspaceEmail}
            gmailAddress={gmailAddress}
            outlookAccountType={outlookAccountType}
            routableNodeCount={routableNodeCount}
            onClose={closePreview}
            onDraftStarted={triage.handleDraftStarted}
            onDraftFailed={triage.handleDraftFailed}
            onDraftGenerated={triage.handleDraftGenerated}
            onDraftSentToggled={triage.handleDraftSentToggled}
            onMarkDone={triage.handleMarkDone}
            onUnmarkDone={triage.handleUnmarkDone}
            onCommentsSync={triage.handleCommentsSync}
            onToggleImportant={triage.handleToggleImportant}
            canAssign={canAssign}
            onOpenAssign={openAssignFor}
            onOpenPlanSetup={() => setPlanSetup("choice")}
            members={members}
            currentUserId={currentUserId}
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
          {...(members.length < 2
            ? {
                // Members are managed in the web app; deep-link there (same
                // pattern as the "Plan sorting" link in the preview pane).
                onAddMembers: () => {
                  closeAssign();
                  const path = inviteNeedsUpgrade
                    ? "/upgrade?ctx=collaborators"
                    : "/settings#team-members";
                  void openWebApp(api, path);
                },
                addMembersRequiresUpgrade: inviteNeedsUpgrade,
              }
            : {})}
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

      {/* Overlays the whole panel, so it sits outside the empty-state branch:
          every entry point (status row, empty state, preview pane) lands here. */}
      {planSetup && (
        <Suspense
          fallback={
            <div className="ps-overlay">
              <div className="ax-center">
                <span className="ax-spinner" aria-label={_(msg`Loading`)} />
              </div>
            </div>
          }
        >
          <PlanSetupDialog
            api={api}
            workspaceId={workspaceId}
            initialMode={planSetup}
            onOpenWeb={(path) => void openWebApp(api, path)}
            onApplied={onPlanApplied}
            onClose={() => setPlanSetup(null)}
          />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense
          fallback={
            <div className="ps-overlay">
              <div className="ax-center">
                <span className="ax-spinner" aria-label={_(msg`Loading`)} />
              </div>
            </div>
          }
        >
          <SettingsOverlay
            api={api}
            workspaceId={workspaceId}
            onUpgrade={() => {
              setSettingsOpen(false);
              setUpgradeOpen(true);
            }}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      )}

      {editorOpen && (
        <Suspense
          fallback={
            <div className="ps-overlay">
              <div className="ax-center">
                <span className="ax-spinner" aria-label={_(msg`Loading`)} />
              </div>
            </div>
          }
        >
          <TaxonomyEditorOverlay
            api={api}
            workspaceId={workspaceId}
            // TriageGate only renders this panel behind an ACTIVE connection,
            // so a mailbox is always connected by the time the editor opens.
            mailConnected
            onOpenPlanSetup={(mode) => {
              setEditorOpen(false);
              setPlanSetup(mode);
            }}
            onChanged={onPlanApplied}
            onClose={() => setEditorOpen(false)}
          />
        </Suspense>
      )}

      {checkoutSuccess && (
        <Suspense fallback={null}>
          <UpgradeSuccessOverlay
            plan={checkoutSuccess.plan}
            purchasedWorkspaceId={checkoutSuccess.workspaceId}
            purchasedWorkspaceName={
              workspaces.find((w) => w.id === checkoutSuccess.workspaceId)?.name ?? workspaceName
            }
            currentWorkspaceId={workspaceId}
            onSwitchWorkspace={(id) => {
              setCheckoutSuccess(null);
              switchWorkspace(id);
            }}
            onDone={() => setCheckoutSuccess(null)}
          />
        </Suspense>
      )}

      {upgradeOpen && (
        <Suspense
          fallback={
            <div className="ug-overlay">
              <div className="ax-center">
                <span className="ax-spinner" aria-label={_(msg`Loading`)} />
              </div>
            </div>
          }
        >
          <UpgradeDialog
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            mascotSrc={MASCOT_SRC}
            currentPlan={syncStatus?.workspacePlan ?? "FREE"}
            startCheckout={(input) => startCheckout({ ...input, mailProvider: provider })}
            onCheckoutStarted={handleCheckoutStarted}
            onUpgraded={() => {
              api.syncStatus(workspaceId).then(setSyncStatus).catch(() => {});
              void refreshWorkspaces();
            }}
            onClose={() => setUpgradeOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
