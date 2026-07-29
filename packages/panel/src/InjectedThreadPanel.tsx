"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import {
  makeApiClient,
  makeBearerTransport,
  readUserIdFromAccessToken,
  type ApiClient,
} from "@amarnai/api-client";
import { mapFolders, mapMembers } from "@amarnai/core/emails";
import type { PanelHost } from "./host.js";
import { usePanelState } from "./usePanelState.js";
import { ClassificationCard } from "./ClassificationCard.js";
import { SummarySection } from "./SummarySection.js";
import { DraftSection } from "./DraftSection.js";
import type { EmailThreadDetail, FolderItem, MemberItem } from "./types.js";
import {
  ErrorState,
  InjectionDisabledState,
  LoadingState,
  MismatchState,
  NoThreadState,
  NotConnectedState,
  NotSyncedState,
  QuotaUpsell,
  SignedOutState,
} from "./states/PanelStates.js";

// Amarnai, rendered inside Gmail and Outlook themselves.
//
// One thread at a time — whichever the user is reading — and nothing else. It
// never lists threads, never fetches message bodies (the mail client is already
// showing them, better than this panel could), and never sends. What it adds to
// the page is the part the mail client does not know: where Amarnai filed this
// thread, why that might be wrong, what it says in two lines, and a reply the
// user can put straight into the client's own compose.
//
// Everything that differs between the two mail clients is behind PanelHost, so
// there is no branch in here on which one we are inside.

export type InjectedThreadPanelProps = {
  host: PanelHost;
  /** The web app origin, for the links out. */
  webAppUrl: string;
  /**
   * Start drafting as soon as a thread loads, without waiting for a click.
   *
   * For entry points that already ARE the request: Outlook's "Amarnai Reply"
   * ribbon button deep-links into the pane, and making the user press a second
   * button inside it would be asking twice. Only ever set from such an entry
   * point — it spends a draft from the monthly allowance.
   */
  autoDraft?: boolean;
  /** Injected by tests; production builds one from the host's token store. */
  client?: ApiClient;
};

export function InjectedThreadPanel({
  host,
  webAppUrl,
  autoDraft = false,
  client,
}: InjectedThreadPanelProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => host.onVisibilityChanged(setVisible), [host]);

  const api = useMemo(
    () =>
      client ??
      makeApiClient(
        makeBearerTransport({
          baseUrl: host.apiBaseUrl,
          tokenStore: host.tokenStore,
        }),
      ),
    [client, host],
  );

  const { stage, refresh, patchThread } = usePanelState({ api, host, visible });

  // Folders and members are loaded on first use, not on thread open: most
  // readers never move a thread or assign it, and both are whole-workspace
  // fetches that would otherwise run on every conversation the user scrolls past.
  const [folders, setFolders] = useState<FolderItem[] | null>(null);
  const [members, setMembers] = useState<MemberItem[] | null>(null);
  const foldersRequested = useRef(false);
  const membersRequested = useRef(false);

  const workspaceId = stage.kind === "thread" ? stage.workspaceId : null;

  // A workspace switch (the user moved to a different mailbox's tab) invalidates
  // both caches; they are per-workspace data.
  useEffect(() => {
    setFolders(null);
    setMembers(null);
    foldersRequested.current = false;
    membersRequested.current = false;
  }, [workspaceId]);

  const requestFolders = useCallback(() => {
    if (foldersRequested.current || !workspaceId) return;
    foldersRequested.current = true;
    void Promise.all([api.taxonomyNodes(workspaceId), api.taxonomyEdges(workspaceId)])
      .then(([nodes, edges]) => setFolders(mapFolders(nodes, edges)))
      .catch(() => {
        foldersRequested.current = false;
      });
  }, [api, workspaceId]);

  const requestMembers = useCallback(() => {
    if (membersRequested.current || !workspaceId) return;
    membersRequested.current = true;
    void api
      .workspaces()
      .then((workspaces) => {
        const found = workspaces.find((w) => w.id === workspaceId);
        setMembers(mapMembers(found?.members ?? []));
      })
      .catch(() => {
        membersRequested.current = false;
      });
  }, [api, workspaceId]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  //
  // Optimistic, then reconciled from the server's echo. These are the same
  // routes the web app calls, addressed by our own thread id, so metering and
  // audit are identical whichever surface the user happened to act from.

  const thread = stage.kind === "thread" ? stage.thread : null;

  const handleMove = useCallback(
    (nodeId: string) => {
      if (!thread || !workspaceId) return;
      const folder = folders?.find((f) => f.id === nodeId);
      const previous = thread.latestClassification;
      patchThread({
        triageStatus: "SORTED",
        latestClassification: previous
          ? { ...previous, finalNode: { id: nodeId, name: folder?.name ?? "" } }
          : previous,
      });
      void api
        .triageThread(workspaceId, thread.id, { action: "move", nodeId })
        .then(refresh)
        .catch(refresh);
    },
    [api, folders, patchThread, refresh, thread, workspaceId],
  );

  const handleToggleDone = useCallback(async () => {
    if (!thread || !workspaceId) return;
    const wasDone = !!thread.doneMark;
    if (wasDone) {
      // Clearing is fully known client-side, so it can be optimistic. Marking
      // is not: the mark carries who did it and when, and inventing that here
      // to replace it a moment later would show the wrong name in between.
      patchThread({ doneMark: null });
    }
    // The server records the actor from the auth context and ignores this
    // argument — deliberately, so no member can record an action as another
    // (see resolve-thread.ts). It is still passed truthfully rather than as a
    // placeholder, so nothing here depends on that staying true.
    const actorId = (await host.tokenStore.get().catch(() => null))?.accessToken;
    const userId = actorId ? (readUserIdFromAccessToken(actorId) ?? "") : "";
    const call = wasDone
      ? api.unmarkThreadDone(workspaceId, thread.id, userId)
      : api.markThreadDone(workspaceId, thread.id, userId);
    void call.then(({ doneMark }) => patchThread({ doneMark })).catch(refresh);
  }, [api, host, patchThread, refresh, thread, workspaceId]);

  const handleToggleImportant = useCallback(() => {
    if (!thread || !workspaceId) return;
    const next = !thread.isImportant;
    patchThread({ isImportant: next });
    void api
      .setThreadImportant(workspaceId, thread.id, next)
      .catch(() => patchThread({ isImportant: !next }));
  }, [api, patchThread, thread, workspaceId]);

  const handleAssign = useCallback(
    (userId: string | null) => {
      if (!thread || !workspaceId) return;
      const call = userId
        ? api.assignThread(workspaceId, thread.id, userId)
        : api.unassignThread(workspaceId, thread.id);
      void call.then(({ assignment }) => patchThread({ assignment })).catch(refresh);
    },
    [api, patchThread, refresh, thread, workspaceId],
  );

  const handleSortNow = useCallback(() => {
    if (!thread || !workspaceId) return;
    patchThread({ isClassifying: true, isQueued: true });
    void api.aiClassify(workspaceId, thread.id).catch(refresh);
  }, [api, patchThread, refresh, thread, workspaceId]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const openApp = host.capabilities.openExternal
    ? () => host.openExternal(webAppUrl)
    : null;

  return (
    <div className="apn-root">
      {stage.kind === "loading" || stage.kind === "resolving" ? (
        <LoadingState />
      ) : stage.kind === "signedOut" ? (
        <SignedOutState onSignIn={host.capabilities.signIn ? () => host.requestSignIn() : null} />
      ) : stage.kind === "notConnected" ? (
        <NotConnectedState onOpenApp={openApp} />
      ) : stage.kind === "mismatch" ? (
        <MismatchState accountEmail={stage.accountEmail} knownAccounts={stage.knownAccounts} />
      ) : stage.kind === "noThread" ? (
        <NoThreadState />
      ) : stage.kind === "unknownThread" ? (
        <NotSyncedState onRetry={refresh} />
      ) : stage.kind === "injectionDisabled" ? (
        <InjectionDisabledState />
      ) : stage.kind === "error" ? (
        <ErrorState onRetry={refresh} />
      ) : (
        <ThreadView
          api={api}
          host={host}
          webAppUrl={webAppUrl}
          workspaceId={stage.workspaceId}
          thread={stage.thread}
          accountEmail={stage.accountEmail}
          autoDraft={autoDraft}
          folders={folders}
          members={members}
          onRequestFolders={requestFolders}
          onRequestMembers={requestMembers}
          onMove={handleMove}
          onToggleDone={() => void handleToggleDone()}
          onToggleImportant={handleToggleImportant}
          onAssign={handleAssign}
          onSortNow={handleSortNow}
        />
      )}
    </div>
  );
}

function ThreadView({
  api,
  host,
  webAppUrl,
  workspaceId,
  thread,
  accountEmail,
  autoDraft,
  folders,
  members,
  onRequestFolders,
  onRequestMembers,
  onMove,
  onToggleDone,
  onToggleImportant,
  onAssign,
  onSortNow,
}: {
  api: ApiClient;
  host: PanelHost;
  webAppUrl: string;
  workspaceId: string;
  thread: EmailThreadDetail;
  accountEmail: string;
  autoDraft: boolean;
  folders: FolderItem[] | null;
  members: MemberItem[] | null;
  onRequestFolders: () => void;
  onRequestMembers: () => void;
  onMove: (nodeId: string) => void;
  onToggleDone: () => void;
  onToggleImportant: () => void;
  onAssign: (userId: string | null) => void;
  onSortNow: () => void;
}) {
  return (
    <>
      {thread.triageStatus === "QUOTA_BLOCKED" && (
        <QuotaUpsell
          onUpgrade={
            host.capabilities.openExternal
              ? () => host.openExternal(`${webAppUrl}/settings/billing`)
              : null
          }
        />
      )}

      <ClassificationCard
        thread={thread}
        folders={folders}
        members={members}
        canAssign={(members?.length ?? 0) > 1 || !!thread.assignment}
        onRequestFolders={onRequestFolders}
        onRequestMembers={onRequestMembers}
        onMove={onMove}
        onToggleDone={onToggleDone}
        onToggleImportant={onToggleImportant}
        onAssign={onAssign}
        onSortNow={onSortNow}
      />

      <SummarySection api={api} workspaceId={workspaceId} thread={thread} />

      <DraftSection
        api={api}
        workspaceId={workspaceId}
        thread={thread}
        accountEmail={accountEmail}
        autoDraft={autoDraft}
        canInsert={host.capabilities.insertDraft}
        insertDraft={host.insertDraft.bind(host)}
      />

      {host.capabilities.openExternal && (
        <button
          type="button"
          className="apn-link"
          onClick={() => host.openExternal(`${webAppUrl}/emails?thread=${thread.id}`)}
        >
          <Trans>Open in Amarnai</Trans>
        </button>
      )}
    </>
  );
}
