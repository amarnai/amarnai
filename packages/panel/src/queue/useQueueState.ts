import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  InjectionDisabledError,
  readUserIdFromAccessToken,
  type ApiClient,
} from "@aziru/api-client";
import type { PanelHost } from "../host.js";
import { makePanelSseDeps, useWorkspaceEvents } from "../realtime/index.js";
import type { PanelQueueResult, PanelQueueThread, SyncStatus } from "../types.js";

// Loading and maintaining the queue the panel shows when no conversation is open.
//
// The load pattern is decided by one fact: the panel is remounted every time the
// user moves between the thread list and a conversation, which in a mail client
// is constantly. A plain fetch-on-mount would mean a round trip per navigation,
// in every open tab, for data that rarely changes between two of them. So the
// last response is cached per workspace and rendered immediately, while a
// refresh runs behind it — and the live stream keeps it honest while mounted.

/**
 * How long a cached queue is served before the next mount refetches. Short
 * enough that a stale row is a blink rather than a state, long enough that
 * clicking through half a dozen conversations costs one request.
 */
const CACHE_TTL_MS = 60_000;

/** Collapses a burst of events (a sort finishing over many threads) into one refetch. */
const EVENT_DEBOUNCE_MS = 2_000;

/**
 * Fallback poll while something is in flight. The stream already reports these,
 * so this only covers a proxy that buffers event streams or a connection inside
 * its backoff — hence far slower than the thread view's 5s.
 */
const ACTIVE_POLL_MS = 15_000;

type CacheEntry = { at: number; queue: PanelQueueResult; syncStatus: SyncStatus | null };

// Module-level, so it survives the remount that is the whole point of it. Keyed
// by workspace: a second mailbox in another tab must not read this one's queue.
const cache = new Map<string, CacheEntry>();

/** Test seam, and the sign-out path: a new session must not see the old queue. */
export function clearQueueCache(): void {
  cache.clear();
}

/**
 * Mark the cached queue as stale without throwing it away.
 *
 * Called by the OTHER screen: the thread view mutates the same threads this
 * queue lists — marking one done, assigning it, moving it out of review — and
 * the two never share a render, so without this the queue would keep serving
 * its pre-mutation copy for the rest of the TTL. Coming back from a
 * conversation to find the change you just made missing is the worst kind of
 * wrong, because it reads as the change not having happened.
 *
 * Expired rather than deleted: the stale rows are still worth showing for the
 * length of one request, and dropping the entry would blank the queue to a
 * spinner every time. The next load renders what it has and replaces it with
 * the truth.
 */
export function invalidateQueue(workspaceId: string): void {
  const entry = cache.get(workspaceId);
  if (entry) cache.set(workspaceId, { ...entry, at: 0 });
}

export type QueueState = {
  queue: PanelQueueResult | null;
  syncStatus: SyncStatus | null;
  /** Only true when there is nothing at all to show; a refresh behind data is silent. */
  loading: boolean;
  error: boolean;
  refresh: () => void;
  toggleDone: (thread: PanelQueueThread) => void;
};

type Deps = {
  api: ApiClient;
  host: PanelHost;
  workspaceId: string;
  /** Whether the panel is on screen. Gates the stream and the poll. */
  visible: boolean;
  /** The workspace switched the panel off; the whole panel latches on it. */
  onInjectionDisabled: () => void;
};

export function useQueueState({
  api,
  host,
  workspaceId,
  visible,
  onInjectionDisabled,
}: Deps): QueueState {
  const cached = cache.get(workspaceId);
  const [queue, setQueue] = useState<PanelQueueResult | null>(cached?.queue ?? null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(cached?.syncStatus ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Retires a response for a workspace the panel has already left, so a slow
  // fetch cannot render another mailbox's queue over this one.
  const tokenRef = useRef(0);
  // The queue as of the last write, readable from outside a render. Kept in step
  // by every path that sets it, so a mutation landing after an unmount still has
  // something correct to patch.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const onInjectionDisabledRef = useRef(onInjectionDisabled);
  onInjectionDisabledRef.current = onInjectionDisabled;

  /**
   * Refetch now, whatever the cache says. Everything that knows the queue has
   * changed — the retry button, a live event, the poll — goes through here, so
   * "invalidate then reload" is one operation rather than three copies of two.
   */
  const refresh = useCallback(() => {
    invalidateQueue(workspaceId);
    setRefreshKey((k) => k + 1);
  }, [workspaceId]);

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const token = ++tokenRef.current;

    const entry = cache.get(workspaceId);
    if (entry) {
      setQueue(entry.queue);
      setSyncStatus(entry.syncStatus);
      setLoading(false);
      // Shown first either way, so a revalidation never blanks the queue. It is
      // also all we do while the entry is inside its TTL: anything that knows
      // better has expired it, which is what drops through to the fetch below.
      if (Date.now() - entry.at < CACHE_TTL_MS) return;
    } else {
      setLoading(true);
    }

    void (async () => {
      try {
        // The sync status is a separate route and a separate concern (it belongs
        // to the mailbox, not the queue), but both feed one screen, so they are
        // fetched together rather than in sequence. A failing sync status must
        // not cost the queue: it only decides whether a strip is shown.
        const [nextQueue, nextSync] = await Promise.all([
          api.panelQueue(workspaceId),
          api.syncStatus(workspaceId).catch(() => null),
        ]);
        if (token !== tokenRef.current) return;
        cache.set(workspaceId, { at: Date.now(), queue: nextQueue, syncStatus: nextSync });
        setQueue(nextQueue);
        setSyncStatus(nextSync);
        setError(false);
        setLoading(false);
      } catch (e) {
        if (token !== tokenRef.current) return;
        if (e instanceof InjectionDisabledError) {
          // Not this hook's screen to show: the whole panel latches it, exactly
          // as it does when a thread resolve is refused.
          onInjectionDisabledRef.current();
          return;
        }
        setError(true);
        setLoading(false);
      }
    })();
  }, [api, workspaceId, visible, refreshKey]);

  // ── Live updates ────────────────────────────────────────────────────────────
  const sseDeps = useMemo(() => makePanelSseDeps(api, host), [api, host]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      refreshRef.current();
    }, EVENT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handlers = useMemo(
    () => ({
      // Every thread event, not just one thread's: any sort outcome can add to
      // or remove from a section, and the event deliberately carries none of the
      // detail needed to work out which.
      onThreadEvent: scheduleRefresh,
      // New mail lands in the queue too — a thread that arrives already assigned,
      // or one that comes back needing review.
      onSynced: scheduleRefresh,
    }),
    [scheduleRefresh],
  );
  // `visible` gates the connection: a mail client can have many tabs open, and
  // one stream per hidden sidebar is a cost with no reader.
  useWorkspaceEvents(sseDeps, workspaceId, handlers, visible);

  // ── Fallback poll ───────────────────────────────────────────────────────────
  const inFlight = queue ? queue.pendingCount - queue.pendingWaitingCount : 0;
  const active = inFlight > 0 || syncStatus?.backfillStatus === "RUNNING";
  useEffect(() => {
    if (!active || !visible) return;
    const timer = setInterval(() => refreshRef.current(), ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, visible]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const toggleDone = useCallback(
    (thread: PanelQueueThread) => {
      const wasDone = !!thread.doneMark;

      // Written through the ref rather than from inside a setQueue updater.
      // Updaters must be pure — React is entitled to run one twice, and skips it
      // entirely once the component has unmounted, which here is the common case:
      // acting on a row and then opening the conversation unmounts this queue
      // while the request is still in flight, and the cache would silently keep
      // the state the user just changed.
      const apply = (mark: PanelQueueThread["doneMark"]) => {
        const current = queueRef.current;
        if (!current) return;
        const next = patchThreadInQueue(current, thread.id, mark);
        queueRef.current = next;
        const entry = cache.get(workspaceId);
        if (entry) cache.set(workspaceId, { ...entry, queue: next });
        setQueue(next);
      };

      // Clearing is fully known here, so it can be optimistic. Marking is not:
      // the mark carries who did it and when, and inventing that to replace it a
      // moment later would show the wrong name in between.
      if (wasDone) apply(null);

      void (async () => {
        // The server records the actor from the auth context and ignores this
        // argument. It is still passed truthfully rather than as a placeholder,
        // so nothing here depends on that staying true.
        const accessToken = (await host.tokenStore.get().catch(() => null))?.accessToken;
        const userId = accessToken ? (readUserIdFromAccessToken(accessToken) ?? "") : "";
        try {
          const result = wasDone
            ? await api.unmarkThreadDone(workspaceId, thread.id, userId)
            : await api.markThreadDone(workspaceId, thread.id, userId);
          apply(result.doneMark);
        } catch {
          // Put the truth back on screen rather than guessing at it.
          refreshRef.current();
        }
      })();
    },
    [api, host, workspaceId],
  );

  return { queue, syncStatus, loading, error, refresh, toggleDone };
}

/**
 * Apply a done mark to one thread wherever it appears.
 *
 * Wherever, plural, on purpose: the sections are lenses over the same threads,
 * so a thread with a draft waiting can also be assigned, and marking it done in
 * one place must not leave the other showing the old state. The assigned section
 * additionally drops it, because that section is "not done" by definition and
 * the server would not return it on the next load either.
 */
function patchThreadInQueue(
  queue: PanelQueueResult,
  threadId: string,
  doneMark: PanelQueueThread["doneMark"],
): PanelQueueResult {
  const mark = (threads: PanelQueueThread[]) =>
    threads.map((t) => (t.id === threadId ? { ...t, doneMark } : t));

  const assignedThreads = doneMark
    ? queue.assignedToMe.threads.filter((t) => t.id !== threadId)
    : mark(queue.assignedToMe.threads);
  const removedFromAssigned =
    assignedThreads.length < queue.assignedToMe.threads.length;

  return {
    ...queue,
    assignedToMe: {
      threads: assignedThreads,
      count: Math.max(0, queue.assignedToMe.count - (removedFromAssigned ? 1 : 0)),
    },
    needsReview: { ...queue.needsReview, threads: mark(queue.needsReview.threads) },
    proposedDrafts: { ...queue.proposedDrafts, threads: mark(queue.proposedDrafts.threads) },
  };
}
