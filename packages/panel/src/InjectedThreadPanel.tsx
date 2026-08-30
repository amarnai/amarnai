"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import {
  makeApiClient,
  makeBearerTransport,
  readUserIdFromAccessToken,
  type ApiClient,
} from "@aziru/api-client";
import { mapFolders, mapMembers } from "@aziru/core/emails";
import type { PanelHost } from "./host.js";
import { usePanelState } from "./usePanelState.js";
import { ClassificationCard } from "./ClassificationCard.js";
import { SummarySection } from "./SummarySection.js";
import { DraftSection } from "./DraftSection.js";
import { CommentsSection } from "./CommentsSection.js";
import { QueuePanel } from "./queue/QueuePanel.js";
import { invalidateQueue } from "./queue/useQueueState.js";
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
// Two screens, decided by what the mail client is showing. On a conversation:
// that thread and nothing else — where Amarnai filed it, why that might be
// wrong, what it says in two lines, and a reply the user can put straight into
// the client's own compose. On the thread list: the queue, meaning the few
// threads actually waiting on this user, each one click from being opened or
// marked done.
//
// Which screen is showing follows the mail client, with one exception: a back
// control on each screen moves between them without touching the page, so the
// queue can be consulted with a conversation still open beside it. It is a
// screen change and not a history step, which is why it is offered even to a
// reader who never came from the queue.
//
// The queue is where the boundary is worth stating, because it is the one place
// this panel could drift into being a mail client. It is an action queue, not a
// thread browser: no folder navigation, no search, no paging, nothing that
// duplicates the list already on screen beside it. And in neither screen does
// the panel fetch message bodies (the mail client is already showing them,
// better than this could) or send anything.
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
  /**
   * Open the comments section expanded and scrolled into view as soon as a
   * thread loads. Same contract as autoDraft: only set from an entry point
   * that already is the request (Outlook's "Comments" ribbon button).
   */
  focusComments?: boolean;
  /** Injected by tests; production builds one from the host's token store. */
  client?: ApiClient;
};

export function InjectedThreadPanel({
  host,
  webAppUrl,
  autoDraft = false,
  focusComments = false,
  client,
}: InjectedThreadPanelProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => host.onVisibilityChanged(setVisible), [host]);

  // "Expand + scroll the Comments section" requests, as a nonce so repeat
  // clicks on the in-page bubble re-focus an already-open section. Seeded from
  // the mount-time focusComments prop (Outlook's ribbon deep-link); bumped by
  // hosts with in-page chrome via onFocusComments (the summary-card bubble).
  const [focusCommentsNonce, setFocusCommentsNonce] = useState(focusComments ? 1 : 0);
  useEffect(
    () => host.onFocusComments?.(() => setFocusCommentsNonce((n) => n + 1)),
    [host],
  );

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

  const {
    stage,
    threadIsOpenInClient,
    refresh,
    patchThread,
    reportInjectionDisabled,
    showQueue,
    showConversation,
    openThread,
  } = usePanelState({
    api,
    host,
    visible,
  });

  // Folders are loaded on first use, not on thread open: most readers never move
  // a thread, and it is a whole-workspace fetch that would otherwise run on
  // every conversation the user scrolls past. Members are fetched once per
  // workspace as soon as a thread loads — the assign control is always offered
  // (as in the web app and the side panel), and a picker that opens empty while
  // its members load reads as a broken button.
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

  // Cached per workspace by the ref above, so this is one call per mailbox for
  // the life of the panel, not one per conversation.
  useEffect(() => {
    if (workspaceId) requestMembers();
  }, [workspaceId, requestMembers]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  //
  // Optimistic, then reconciled from the server's echo. These are the same
  // routes the web app calls, addressed by our own thread id, so metering and
  // audit are identical whichever surface the user happened to act from.
  //
  // Each one also drops the queue's cached copy, because every one of them can
  // change which of its sections this thread belongs in: done and assign decide
  // the assigned list outright, and a move or a re-sort decides whether it still
  // needs review. The two screens never render together, so the queue cannot
  // learn any of this by itself — and returning to it to find the change you
  // just made missing reads as the change not having happened.

  const thread = stage.kind === "thread" ? stage.thread : null;

  const dropQueueCache = useCallback(() => {
    if (workspaceId) invalidateQueue(workspaceId);
  }, [workspaceId]);

  const handleMove = useCallback(
    (nodeId: string) => {
      if (!thread || !workspaceId) return;
      const folder = folders?.find((f) => f.id === nodeId);
      const previous = thread.latestClassification;
      const moved = { id: nodeId, name: folder?.name ?? "" };
      patchThread({
        triageStatus: "SORTED",
        latestClassification: previous ? { ...previous, finalNode: moved } : previous,
        filedNode: moved,
      });
      dropQueueCache();
      void api
        .triageThread(workspaceId, thread.id, { action: "move", nodeId })
        .then(refresh)
        .catch(refresh);
    },
    [api, dropQueueCache, folders, patchThread, refresh, thread, workspaceId],
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
    dropQueueCache();
    void call.then(({ doneMark }) => patchThread({ doneMark })).catch(refresh);
  }, [api, dropQueueCache, host, patchThread, refresh, thread, workspaceId]);

  const handleAssign = useCallback(
    (userId: string | null) => {
      if (!thread || !workspaceId) return;
      const call = userId
        ? api.assignThread(workspaceId, thread.id, userId)
        : api.unassignThread(workspaceId, thread.id);
      dropQueueCache();
      void call.then(({ assignment }) => patchThread({ assignment })).catch(refresh);
    },
    [api, dropQueueCache, patchThread, refresh, thread, workspaceId],
  );

  const handleSortNow = useCallback(() => {
    if (!thread || !workspaceId) return;
    patchThread({ isClassifying: true, isQueued: true });
    dropQueueCache();
    void api.aiClassify(workspaceId, thread.id).catch(refresh);
  }, [api, dropQueueCache, patchThread, refresh, thread, workspaceId]);

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
      ) : stage.kind === "queue" ? (
        <>
          {stage.overConversation && (
            <BackButton onClick={showConversation}>
              <Trans>This conversation</Trans>
            </BackButton>
          )}
          <QueuePanel
            api={api}
            host={host}
            workspaceId={stage.workspaceId}
            accountEmail={stage.accountEmail}
            visible={visible}
            onInjectionDisabled={reportInjectionDisabled}
            onOpenThread={openThread}
          />
        </>
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
          focusCommentsNonce={focusCommentsNonce}
          canInsertDraft={host.capabilities.insertDraft && threadIsOpenInClient}
          folders={folders}
          members={members}
          onRequestFolders={requestFolders}
          onRequestMembers={requestMembers}
          onMove={handleMove}
          onToggleDone={() => void handleToggleDone()}
          onAssign={handleAssign}
          onSortNow={handleSortNow}
          onShowQueue={showQueue}
        />
      )}
    </div>
  );
}

/**
 * The panel's only navigation control, in both directions between its two
 * screens. Deliberately one component and one glyph: each screen is where the
 * other was reached from, so both really are a way back, and giving them
 * different shapes would suggest one of them moves the mail client too.
 */
function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="apn-back" onClick={onClick}>
      <span className="apn-back-arrow" aria-hidden>
        ←
      </span>
      {children}
    </button>
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
  focusCommentsNonce,
  canInsertDraft,
  folders,
  members,
  onRequestFolders,
  onRequestMembers,
  onMove,
  onToggleDone,
  onAssign,
  onSortNow,
  onShowQueue,
}: {
  api: ApiClient;
  host: PanelHost;
  webAppUrl: string;
  workspaceId: string;
  thread: EmailThreadDetail;
  accountEmail: string;
  autoDraft: boolean;
  focusCommentsNonce: number;
  /**
   * False while this thread was picked from the queue and the mail client is
   * still showing another one: both hosts insert into whatever conversation the
   * client has open, so the draft would land in the wrong thread.
   */
  canInsertDraft: boolean;
  folders: FolderItem[] | null;
  members: MemberItem[] | null;
  onRequestFolders: () => void;
  onRequestMembers: () => void;
  onMove: (nodeId: string) => void;
  onToggleDone: () => void;
  onAssign: (userId: string | null) => void;
  onSortNow: () => void;
  onShowQueue: () => void;
}) {
  return (
    <>
      {/*
       * Back to the queue, not back in the mail client: the conversation stays
       * open beside the panel, which is what makes this cheap to press. It is
       * offered whether or not the user arrived from the queue, because it is
       * navigation between the panel's two screens rather than a history step.
       */}
      <BackButton onClick={onShowQueue}>
        <Trans>Threads to handle</Trans>
      </BackButton>

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
        canAssign
        onRequestFolders={onRequestFolders}
        onRequestMembers={onRequestMembers}
        onMove={onMove}
        onToggleDone={onToggleDone}
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
        canInsert={canInsertDraft}
        insertDraft={host.insertDraft.bind(host)}
      />

      <CommentsSection
        api={api}
        host={host}
        workspaceId={workspaceId}
        thread={thread}
        members={members}
        focusNonce={focusCommentsNonce}
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
