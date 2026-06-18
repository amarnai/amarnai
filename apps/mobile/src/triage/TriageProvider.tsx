import { createContext, useContext, type ReactNode } from 'react';
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
import type { ApiClient } from '@amarnai/api-client';
import { colors } from '@amarnai/tokens';

type Triage = ReturnType<typeof useEmailTriage>;

const TriageContext = createContext<Triage | null>(null);

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
}

function TriageInner({
  children,
  api,
  workspaceId,
  userId,
  initialFolders,
  initialThreads,
}: TriageInnerProps) {
  const triage = useEmailTriage({
    api,
    workspaceId,
    currentUserId: userId,
    initialThreads,
    initialFolders,
    initialActive: { kind: 'queue', id: 'all' } as ActiveSelection,
    initialSelectedId: null,
  });

  return <TriageContext.Provider value={triage}>{children}</TriageContext.Provider>;
}

export function useTriage(): Triage {
  const ctx = useContext(TriageContext);
  if (!ctx) throw new Error('useTriage must be used within a TriageProvider');
  return ctx;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
