import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  mapFolders,
  mapThreads,
  useEmailTriage,
  type ActiveSelection,
  type FolderItem,
  type ThreadItem,
} from '@amarnai/core';
import type { ApiClient, FilterCounts } from '@amarnai/api-client';
import { colors } from '@amarnai/tokens';

type Triage = ReturnType<typeof useEmailTriage>;

// The action surface is the set of stable (useCallback) functions. Splitting it
// into its own context lets action-only consumers (e.g. useThreadDraft) subscribe
// without re-rendering on every triage state change.
type TriageActions = Pick<
  Triage,
  | 'setActive'
  | 'setSelectedId'
  | 'setQuery'
  | 'syncThreads'
  | 'syncFolders'
  | 'refresh'
  | 'loadThread'
  | 'loadMore'
  | 'handleMarkDone'
  | 'handleUnmarkDone'
  | 'handleToggleImportant'
  | 'handleAssign'
  | 'openRerouteFor'
  | 'closeReroute'
  | 'commitReroute'
  | 'handleDraftStarted'
  | 'handleDraftFailed'
  | 'handleDraftGenerated'
  | 'handleDraftSentToggled'
  | 'handleCommentsSync'
  | 'handleReroute'
  | 'markWaitingClassifying'
  | 'showToast'
  | 'dismissToast'
  | 'isWaiting'
>;

type TriageState = Omit<Triage, keyof TriageActions>;

const TriageStateContext = createContext<TriageState | null>(null);
const TriageActionsContext = createContext<TriageActions | null>(null);

interface TriageProviderProps {
  children: ReactNode;
  api: ApiClient;
  workspaceId: string;
  userId: string;
}

/**
 * Loads the initial triage seed (taxonomy + threads) and shows a splash until it
 * is ready, then mounts {@link TriageInner}. The split matters: `useEmailTriage`
 * seeds its thread/folder state once via `useState(initial...)`, so it must not be
 * instantiated until the real data exists. Mounting the inner component only after
 * the queries resolve guarantees the hook captures populated arrays, not the empty
 * placeholders from the loading renders.
 */
export function TriageProvider({ children, api, workspaceId, userId }: TriageProviderProps) {
  const { data: nodes } = useQuery({
    queryKey: ['taxonomyNodes', workspaceId],
    queryFn: () => api.taxonomyNodes(workspaceId),
  });

  const { data: edges } = useQuery({
    queryKey: ['taxonomyEdges', workspaceId],
    queryFn: () => api.taxonomyEdges(workspaceId),
  });

  const { data: threadsResult } = useQuery({
    queryKey: ['emailThreads', workspaceId],
    queryFn: () => api.emailThreads(workspaceId),
  });

  if (!nodes || !edges || !threadsResult) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <TriageInner
      api={api}
      workspaceId={workspaceId}
      userId={userId}
      initialFolders={mapFolders(nodes, edges)}
      initialThreads={mapThreads(threadsResult.threads)}
      initialNextCursor={threadsResult.nextCursor}
      initialCounts={threadsResult.counts}
      initialFilteredTotal={threadsResult.filteredTotal}
    >
      {children}
    </TriageInner>
  );
}

interface TriageInnerProps {
  children: ReactNode;
  api: ApiClient;
  workspaceId: string;
  userId: string;
  initialFolders: FolderItem[];
  initialThreads: ThreadItem[];
  initialNextCursor: string | null;
  initialCounts: FilterCounts;
  initialFilteredTotal: number;
}

function TriageInner({
  children,
  api,
  workspaceId,
  userId,
  initialFolders,
  initialThreads,
  initialNextCursor,
  initialCounts,
  initialFilteredTotal,
}: TriageInnerProps) {
  const triage = useEmailTriage({
    api,
    workspaceId,
    currentUserId: userId,
    initialThreads,
    initialNextCursor,
    initialCounts,
    initialFilteredTotal,
    initialFolders,
    initialActive: { kind: 'queue', id: 'all' } as ActiveSelection,
    initialSelectedId: null,
  });

  // Actions are stable (useEmailTriage memoizes them), so this object's identity
  // never changes after mount → action-only consumers don't re-render on state.
  const actions = useMemo<TriageActions>(
    () => ({
      setActive: triage.setActive,
      setSelectedId: triage.setSelectedId,
      setQuery: triage.setQuery,
      syncThreads: triage.syncThreads,
      syncFolders: triage.syncFolders,
      refresh: triage.refresh,
      loadThread: triage.loadThread,
      loadMore: triage.loadMore,
      handleMarkDone: triage.handleMarkDone,
      handleUnmarkDone: triage.handleUnmarkDone,
      handleToggleImportant: triage.handleToggleImportant,
      handleAssign: triage.handleAssign,
      openRerouteFor: triage.openRerouteFor,
      closeReroute: triage.closeReroute,
      commitReroute: triage.commitReroute,
      handleDraftStarted: triage.handleDraftStarted,
      handleDraftFailed: triage.handleDraftFailed,
      handleDraftGenerated: triage.handleDraftGenerated,
      handleDraftSentToggled: triage.handleDraftSentToggled,
      handleCommentsSync: triage.handleCommentsSync,
      handleReroute: triage.handleReroute,
      markWaitingClassifying: triage.markWaitingClassifying,
      showToast: triage.showToast,
      dismissToast: triage.dismissToast,
      isWaiting: triage.isWaiting,
    }),
    [
      triage.setActive,
      triage.setSelectedId,
      triage.setQuery,
      triage.syncThreads,
      triage.syncFolders,
      triage.refresh,
      triage.loadThread,
      triage.loadMore,
      triage.handleMarkDone,
      triage.handleUnmarkDone,
      triage.handleToggleImportant,
      triage.handleAssign,
      triage.openRerouteFor,
      triage.closeReroute,
      triage.commitReroute,
      triage.handleDraftStarted,
      triage.handleDraftFailed,
      triage.handleDraftGenerated,
      triage.handleDraftSentToggled,
      triage.handleCommentsSync,
      triage.handleReroute,
      triage.markWaitingClassifying,
      triage.showToast,
      triage.dismissToast,
      triage.isWaiting,
    ],
  );

  // Volatile state. New identity whenever any triage state changes — that is the
  // intended behavior for state consumers.
  const state = useMemo<TriageState>(
    () => ({
      threads: triage.threads,
      folders: triage.folders,
      active: triage.active,
      selectedId: triage.selectedId,
      selectedThread: triage.selectedThread,
      query: triage.query,
      rerouteTarget: triage.rerouteTarget,
      toast: triage.toast,
      filteredThreads: triage.filteredThreads,
      filteredIds: triage.filteredIds,
      anyClassifying: triage.anyClassifying,
      waitingCount: triage.waitingCount,
      hasMore: triage.hasMore,
      loadingMore: triage.loadingMore,
      total: triage.total,
      queueCounts: triage.queueCounts,
      serverWaitingCount: triage.serverWaitingCount,
      filteredTotal: triage.filteredTotal,
    }),
    [
      triage.threads,
      triage.folders,
      triage.active,
      triage.selectedId,
      triage.selectedThread,
      triage.query,
      triage.rerouteTarget,
      triage.toast,
      triage.filteredThreads,
      triage.filteredIds,
      triage.anyClassifying,
      triage.waitingCount,
      triage.hasMore,
      triage.loadingMore,
      triage.total,
      triage.queueCounts,
      triage.serverWaitingCount,
      triage.filteredTotal,
    ],
  );

  return (
    <TriageActionsContext.Provider value={actions}>
      <TriageStateContext.Provider value={state}>{children}</TriageStateContext.Provider>
    </TriageActionsContext.Provider>
  );
}

export function useTriageActions(): TriageActions {
  const ctx = useContext(TriageActionsContext);
  if (!ctx) throw new Error('useTriageActions must be used within a TriageProvider');
  return ctx;
}

export function useTriageState(): TriageState {
  const ctx = useContext(TriageStateContext);
  if (!ctx) throw new Error('useTriageState must be used within a TriageProvider');
  return ctx;
}

// Combined view for consumers that need both state and actions (screens). These
// re-render on state changes, which they want; action-only consumers should use
// useTriageActions to avoid that.
export function useTriage(): Triage {
  const state = useTriageState();
  const actions = useTriageActions();
  return { ...state, ...actions } as Triage;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
