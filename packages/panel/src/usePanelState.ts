import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  InjectionDisabledError,
  type ApiClient,
  type EmailThreadDetail,
  resolveMailboxAccount,
  type MailAccount,
  type ProviderRefKind,
} from "@amarnai/api-client";
import type { PanelHost, PanelThreadContext } from "./host.js";
import {
  makePanelSseDeps,
  useWorkspaceEvents,
  type WorkspaceThreadEvent,
} from "./realtime/index.js";

// The whole of "what is this panel showing right now", in one place.
//
// The panel lives inside someone else's UI and has to survive every way that UI
// can be in a state Amarnai cannot act on: nobody signed in, a mailbox that
// belongs to no workspace, a conversation we never synced, a workspace that has
// switched the panel off. Each of those is a named stage with its own screen,
// rather than an error, because none of them is one.
//
// "No conversation open" is the exception: it is not a state Amarnai cannot act
// on, it is the thread list, and there the panel shows the queue. It only
// degrades to `noThread` when the mailbox itself cannot be settled — see
// resolveMailboxAccount in @amarnai/api-client, which is where that rule lives for
// every injected surface — because without one there is no workspace and so
// nothing to show.
//
// The queue is also reachable from a conversation, by the back control on the
// thread screen. That is the one place the panel's screen is not simply a
// reading of the mail client's: the conversation stays open beside it, and the
// override lasts only as long as that conversation does, so the panel never
// argues with the page for longer than the user asked it to.
//
// Picking a row in that queue is the other. The panel shows the thread the user
// picked without waiting for the mail client to agree, because waiting does not
// work: an Outlook pane cannot navigate at all, and Gmail reports nothing when
// asked to open the conversation it is already showing — which is precisely the
// click that would otherwise leave the user staring at the queue they clicked
// in. The pick lasts until the page itself moves, and then the page wins again.

export type PanelStage =
  /** Still working out which of the below we are in. */
  | { kind: "loading" }
  /** No Amarnai session in this host's token store. */
  | { kind: "signedOut" }
  /** Signed in, but no workspace of this user has any mailbox connected. */
  | { kind: "notConnected" }
  /** The open mailbox belongs to no workspace of this user (multi-login). */
  | { kind: "mismatch"; accountEmail: string; knownAccounts: MailAccount[] }
  /** The mail client is not showing a conversation, and no mailbox is settled. */
  | { kind: "noThread" }
  /**
   * The queue: what is waiting on this user in this workspace. Reached either
   * because no conversation is open (the thread list) or because the user asked
   * for it from one, which `overConversation` distinguishes — only then is there
   * a conversation to go back to.
   */
  | { kind: "queue"; workspaceId: string; accountEmail: string; overConversation: boolean }
  /** Resolving the open conversation. */
  | { kind: "resolving" }
  /** The conversation exists in the mailbox but has never synced into Amarnai. */
  | { kind: "unknownThread" }
  /** The workspace has switched the in-mail panel off. Terminal for the session. */
  | { kind: "injectionDisabled" }
  /** Could not reach the API. Retryable. */
  | { kind: "error" }
  /** The thread, loaded. `accountEmail` is the mailbox reading it. */
  | { kind: "thread"; workspaceId: string; accountEmail: string; thread: EmailThreadDetail };

export type PanelState = {
  stage: PanelStage;
  /**
   * Whether the conversation on screen is the one the mail client itself has
   * open. False only while a thread picked from the queue is shown over a page
   * that has not followed — an Outlook pane, which cannot navigate, or a Gmail
   * tab in the moment before it does.
   *
   * It gates inserting a draft: both hosts insert into whatever conversation the
   * client currently has open, so offering that while the panel is showing a
   * different one would put the reply in the wrong thread.
   */
  threadIsOpenInClient: boolean;
  /** Re-resolve the open conversation. Also the retry for the error stage. */
  refresh: () => void;
  /**
   * Replace the loaded thread without a round trip. Used by the mutations
   * (move, done, important, assign), which already know the new value.
   */
  patchThread: (patch: Partial<EmailThreadDetail>) => void;
  /**
   * Latch the injection-disabled screen. The thread path reaches it by way of
   * the resolve call's own 403; the queue has to report it, because it is a
   * different request and the queue stage is reached without ever making the
   * other one.
   */
  reportInjectionDisabled: () => void;
  /** Show the queue without closing the conversation the mail client has open. */
  showQueue: () => void;
  /** Go back to that conversation. */
  showConversation: () => void;
  /**
   * Show a conversation picked from the queue, and ask the mail client to open
   * it too where it can. The panel switches either way.
   */
  openThread: (providerThreadId: string) => void;
};

type Deps = {
  api: ApiClient;
  host: PanelHost;
  /** Whether the panel is on screen. Gates the SSE connection. */
  visible: boolean;
};

/**
 * Whether the host currently has a session. Polling is not an option inside a
 * mail client, so this observes the token store where it can (the extension's
 * chrome.storage is observable and shared with the side panel, so signing in
 * there lights this up) and otherwise re-reads when the conversation changes,
 * which is the moment the user is most likely to have just signed in.
 */
function useSignedIn(host: PanelHost, refreshKey: number): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void host.tokenStore.get().then((tokens) => {
      if (!cancelled) setSignedIn(tokens !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [host, refreshKey]);

  return signedIn;
}

export function usePanelState({ api, host, visible }: Deps): PanelState {
  const [context, setContext] = useState<PanelThreadContext | null>(null);
  const [contextKnown, setContextKnown] = useState(false);
  const [stage, setStage] = useState<PanelStage>({ kind: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const signedIn = useSignedIn(host, refreshKey);

  // The mail accounts are cached for the life of the panel: the mapping from
  // mailbox to workspace changes only when someone connects or disconnects a
  // mailbox, which is not something that happens while a mail page is open.
  // A failed load is NOT cached, so a refresh retries it.
  const accountsRef = useRef<MailAccount[] | null>(null);

  // Retires in-flight work when the conversation changes. Without it, a slow
  // resolve for the thread the user just left resolves later and renders ITS
  // thread under the current conversation's header.
  const tokenRef = useRef(0);

  // ── Which conversation is on screen ─────────────────────────────────────────
  //
  // The mail client's, unless the user picked another one from the queue.
  const [pickedThreadId, setPickedThreadId] = useState<string | null>(null);

  // ── Context feed ────────────────────────────────────────────────────────────
  useEffect(() => {
    return host.onThreadContext((next) => {
      setContext(next);
      setContextKnown(true);
      // A pick outlives the click that made it, not the mail client's next word
      // on where it is. Both hosts report only on an actual change, so this is
      // the user having navigated — and following the page is the panel's whole
      // ordinary behaviour. Clearing when the report IS the picked thread (the
      // Gmail case, a moment after it was asked to open it) costs nothing: the
      // two then name the same conversation and nothing re-resolves.
      setPickedThreadId(null);
    });
  }, [host]);

  // Whether the host could read the page at all — an Office pane with no item
  // selected reports nothing. Kept distinct from a context whose accountEmail is
  // null, which is a page the host DID read and that simply names no mailbox: the
  // first has nothing to resolve, the second resolveMailboxAccount may yet settle.
  const hasContext = context !== null;
  const accountEmail = context?.accountEmail ?? null;
  const pageThreadId = context?.providerThreadId ?? null;
  const providerThreadId = pickedThreadId ?? pageThreadId;
  // Which kind of id we are about to resolve. The page's kind applies only to the
  // page's own id: a thread picked from the queue is named by Amarnai's stored
  // conversation id, so carrying the page's "message" over to it would resolve
  // the picked thread as a message id and 404 every row on that layout.
  const refKind: ProviderRefKind = pickedThreadId ? "thread" : context?.refKind ?? "thread";

  // ── Resolution ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = ++tokenRef.current;
    if (signedIn === null || !contextKnown) return;
    if (!signedIn) {
      setStage({ kind: "signedOut" });
      return;
    }
    if (!hasContext) {
      setStage({ kind: "noThread" });
      return;
    }
    setStage({ kind: "resolving" });

    void (async () => {
      let accounts = accountsRef.current;
      if (!accounts) {
        try {
          accounts = (await api.mailAccounts()).accounts;
          accountsRef.current = accounts;
        } catch {
          if (token === tokenRef.current) setStage({ kind: "error" });
          return;
        }
      }
      if (token !== tokenRef.current) return;

      if (accounts.length === 0) {
        setStage({ kind: "notConnected" });
        return;
      }
      const match = resolveMailboxAccount(accounts, accountEmail);
      if (!match) {
        // An address we could read but do not know is a mismatch, and the screen
        // says which mailbox and which ones are connected. No address and no way
        // to settle on one (several connected) leaves nothing to name, so it
        // falls back to the sentence.
        setStage(
          accountEmail
            ? { kind: "mismatch", accountEmail, knownAccounts: accounts }
            : { kind: "noThread" },
        );
        return;
      }

      // The thread list. Everything above still applies — an unconnected mailbox
      // is unconnected whether or not a conversation is open — which is why this
      // sits after those checks rather than before the accounts lookup.
      if (providerThreadId === null) {
        setStage({
          kind: "queue",
          workspaceId: match.workspaceId,
          accountEmail: match.email,
          overConversation: false,
        });
        return;
      }

      try {
        const thread = await api.resolveProviderThread(
          match.workspaceId,
          providerThreadId,
          refKind,
        );
        if (token !== tokenRef.current) return;
        setStage(
          thread
            ? {
                kind: "thread",
                workspaceId: match.workspaceId,
                accountEmail: match.email,
                thread,
              }
            : { kind: "unknownThread" },
        );
      } catch (e) {
        if (token !== tokenRef.current) return;
        // A refusal, not a failure: the workspace turned the panel off, and no
        // amount of retrying will change that. Terminal for this session.
        setStage(e instanceof InjectionDisabledError ? { kind: "injectionDisabled" } : { kind: "error" });
      }
    })();
    // Keyed on the values rather than the context object: a host that re-reports
    // an unchanged conversation, and the pick being cleared once the page has
    // caught up with it, must not both cost a re-resolve.
  }, [api, accountEmail, hasContext, providerThreadId, refKind, contextKnown, signedIn, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const reportInjectionDisabled = useCallback(() => {
    setStage({ kind: "injectionDisabled" });
  }, []);

  // ── Queue over a conversation ───────────────────────────────────────────────
  //
  // Kept beside the resolved stage rather than inside it, so going back to the
  // conversation is a render and not a re-resolve: the thread the user left is
  // still loaded underneath the whole time.
  const [queueOverride, setQueueOverride] = useState(false);

  // The override belongs to the conversation it was opened from. Opening
  // another one — or returning to the thread list, where the queue is the
  // screen anyway — starts from that conversation's own screen.
  useEffect(() => {
    setQueueOverride(false);
  }, [providerThreadId]);

  const showQueue = useCallback(() => setQueueOverride(true), []);

  const showConversation = useCallback(() => {
    setQueueOverride(false);
    // The queue can change the very thread being returned to (its rows carry
    // the same done control), and while it was on screen the thread held no
    // stream of its own. Re-resolve rather than show what was true a minute ago.
    refresh();
  }, [refresh]);

  const openThread = useCallback(
    (nextProviderThreadId: string) => {
      setPickedThreadId(nextProviderThreadId);
      setQueueOverride(false);
      // Fire and forget, and only where the host has somewhere to fire at: the
      // panel has already decided what it is showing, so nothing here depends on
      // the client answering — or on it being anywhere else to begin with.
      if (host.capabilities.openThread) host.openThread(nextProviderThreadId);
      // For the same reason showConversation does: this thread may be the one
      // already loaded underneath the queue, and the queue's own rows can have
      // changed it since.
      refresh();
    },
    [host, refresh],
  );

  const visibleStage: PanelStage =
    queueOverride && stage.kind === "thread"
      ? {
          kind: "queue",
          workspaceId: stage.workspaceId,
          accountEmail: stage.accountEmail,
          overConversation: true,
        }
      : stage;

  const patchThread = useCallback((patch: Partial<EmailThreadDetail>) => {
    setStage((current) =>
      current.kind === "thread"
        ? { ...current, thread: { ...current.thread, ...patch } }
        : current,
    );
  }, []);

  // ── Live updates ────────────────────────────────────────────────────────────
  //
  // The connection is gated on the panel being on screen: a mail client can have
  // many tabs open, and one SSE connection per hidden sidebar is a cost with no
  // reader.
  const sseDeps = useMemo(() => makePanelSseDeps(api, host), [api, host]);

  // Read through a ref rather than a state updater: the SSE callback is not a
  // render, and calling refresh() (a setState) from inside setStage's updater
  // would make that updater impure — which React is entitled to run twice.
  const loadedThreadIdRef = useRef<string | null>(null);
  loadedThreadIdRef.current = visibleStage.kind === "thread" ? visibleStage.thread.id : null;

  const onThreadEvent = useCallback(
    (event: WorkspaceThreadEvent) => {
      // Only the thread on screen. A sort landing elsewhere in the workspace is
      // none of this panel's business.
      if (event.threadId !== loadedThreadIdRef.current) return;
      // Refetch rather than patch: "classified" changes the folder, the triage
      // status and the review flag at once, and the event deliberately carries
      // none of it.
      refresh();
    },
    [refresh],
  );

  // Thread screen only, and it is the visible stage that decides: the queue
  // holds its own subscription for the workspace it is showing, so gating on
  // what is actually on screen is what keeps this to one stream at a time even
  // while the queue sits over a loaded thread.
  const liveWorkspaceId = visibleStage.kind === "thread" ? visibleStage.workspaceId : null;
  useWorkspaceEvents(sseDeps, liveWorkspaceId, { onThreadEvent }, visible);

  // ── Fallback poll ───────────────────────────────────────────────────────────
  //
  // A thread that is mid-sort has a terminal outcome coming, and SSE may not
  // reach us (a proxy that buffers event streams, a dropped connection inside
  // its backoff). Only runs while a sort is actually in flight, so the steady
  // state costs nothing.
  const isClassifying = visibleStage.kind === "thread" && visibleStage.thread.isClassifying;
  useEffect(() => {
    if (!isClassifying || !visible) return;
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  }, [isClassifying, visible, refresh]);

  return {
    stage: visibleStage,
    // A pick that the page has caught up with is no longer a pick: the two name
    // the same conversation, and the effect above is about to drop it.
    threadIsOpenInClient: pickedThreadId === null || pickedThreadId === pageThreadId,
    refresh,
    patchThread,
    reportInjectionDisabled,
    showQueue,
    showConversation,
    openThread,
  };
}
