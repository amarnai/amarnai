import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import type { QueueId } from '@aziru/core';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';
import { useTriage } from '../../../../src/triage/TriageProvider';
import { AppHeader } from '../../../../src/components/AppHeader';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { Toast } from '../../../../src/components/Toast';
import { QueueChips } from '../../../../src/components/emails/QueueChips';
import { FolderFilterSheet } from '../../../../src/components/emails/FolderFilterSheet';
import { ThreadListView } from '../../../../src/components/emails/ThreadListView';
import { UnroutedBanner } from '../../../../src/components/emails/UnroutedBanner';
import { BackfillBanner } from '../../../../src/components/emails/BackfillBanner';
import { PlanCapBanner } from '../../../../src/components/emails/PlanCapBanner';
import { DisconnectedBanner } from '../../../../src/components/emails/DisconnectedBanner';
import { useSession } from '../../../../src/auth/session';
import { useGmailConnection, useSyncStatus } from '../../../../src/data/queries';
import { useConnectGmail } from '../../../../src/auth/useConnectGmail';
import { useWorkspaceEvents } from '../../../../src/realtime/useWorkspaceEvents';

export default function EmailsScreen() {
  const router = useRouter();
  const { i18n } = useLingui();
  const triage = useTriage();
  const { workspaceId, client } = useSession();

  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [planCapDismissed, setPlanCapDismissed] = useState(false);
  const [focused, setFocused] = useState(false);

  // Keep a stable ref so the focus callback never captures a stale `refresh`.
  const refreshRef = useRef(triage.refresh);
  refreshRef.current = triage.refresh;

  // Refresh once each time the tab regains focus — the catch-up fetch that
  // covers anything missed while the live stream below was disconnected.
  useFocusEffect(
    useCallback(() => {
      refreshRef.current();
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Live updates while this screen is focused and the app is foregrounded:
  // refresh immediately whenever the worker finishes a sync, matching the web
  // app's EventSource. Passing null when unfocused disconnects the stream.
  // Backfill emits `synced` per batch and on completion, so also re-pull the
  // sync status to keep the backfill banner's counts/progress current.
  const syncStatusRefetchRef = useRef<() => void>(() => {});
  useWorkspaceEvents(focused ? workspaceId : null, () => {
    refreshRef.current();
    syncStatusRefetchRef.current();
  });

  // When Gmail was never connected, show an in-app connect CTA instead of the
  // thread list. On success, invalidate the connection query so the empty
  // state clears and the first sync results appear. A DISCONNECTED connection
  // (revoked/expired token) is handled separately by DisconnectedBanner, which
  // shows even when stale threads are still present.
  const connectionQuery = useGmailConnection(workspaceId ?? '');
  const syncStatusQuery = useSyncStatus(workspaceId ?? '');
  syncStatusRefetchRef.current = () => void syncStatusQuery.refetch();
  const showConnectHint = connectionQuery.isSuccess && !connectionQuery.data;
  const { connect: connectGmail, connecting: gmailConnecting } = useConnectGmail(
    workspaceId ?? '',
    client,
  );

  const handleThreadPress = (threadId: string) => {
    triage.setSelectedId(threadId);
    router.push({ pathname: '/(app)/thread/[threadId]', params: { threadId } });
  };

  const handleSelectQueue = (id: QueueId) => {
    triage.setActive({ kind: 'queue', id });
  };

  const handleSelectFolder = (folderId: string) => {
    triage.setActive({ kind: 'folder', id: folderId });
  };

  const handleClearFolder = () => {
    triage.setActive({ kind: 'queue', id: 'all' });
  };

  const handleRouteNow = () => {
    if (!workspaceId) return;
    // Route the PENDING/UNROUTED backlog — the same endpoint the web app uses.
    // (Previously this called rerouteUnclassified, which targets a different set
    // and never arms the auto-route-during-backfill flag.)
    triage.markWaitingClassifying();
    client.routeUnrouted(workspaceId).catch(() => {});
  };

  const activeFolderName =
    triage.active.kind === 'folder'
      ? (triage.folders.find((f) => f.id === triage.active.id)?.name ?? i18n._(msg`Folder`))
      : null;

  const folderName = activeFolderName ?? '';
  const emptyText =
    triage.query
      ? i18n._(msg`No threads match your search`)
      : triage.active.kind === 'folder'
        ? i18n._(msg`No threads in ${folderName}`)
        : i18n._(msg`No threads yet`);

  return (
    <ScreenContainer>
      <AppHeader variant="workspace" />

      <QueueChips
        active={triage.active}
        threads={triage.threads}
        folders={triage.folders}
        queueCounts={triage.queueCounts}
        onSelectQueue={handleSelectQueue}
        onClearFolder={handleClearFolder}
      />

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder={i18n._(msg`Search threads…`)}
          placeholderTextColor={colors.ink4}
          value={triage.query}
          onChangeText={triage.setQuery}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <TouchableOpacity style={styles.folderRow} onPress={() => setFolderSheetOpen(true)}>
        <Text style={styles.folderRowText}>
          {activeFolderName ? (
            <Trans>Folder: {activeFolderName}</Trans>
          ) : (
            <Trans>All folders</Trans>
          )}
        </Text>
        <Text style={styles.folderRowChevron}>▾</Text>
      </TouchableOpacity>

      <UnroutedBanner
        waitingCount={triage.serverWaitingCount}
        routableFolderCount={triage.folders.length}
        routingStarted={syncStatusQuery.data?.backfillRoutingStarted ?? false}
        onRouteNow={handleRouteNow}
      />

      <DisconnectedBanner
        connection={connectionQuery.data}
        workspaceId={workspaceId ?? ''}
        client={client}
        onReconnected={() => {
          void connectionQuery.refetch();
          void syncStatusQuery.refetch();
          refreshRef.current();
        }}
      />

      {showConnectHint && triage.threads.length === 0 ? (
        <View style={styles.hintContainer}>
          <View style={styles.hint}>
            <Text style={styles.hintTitle}>
              <Trans>Connect Gmail to start triaging</Trans>
            </Text>
            <Text style={styles.hintBody}>
              <Trans>
                Connect your Gmail account to sync your inbox into Amarnai. Amarnai
                connects with{' '}
                <Text style={styles.hintBodyStrong}>read-only access</Text> and{' '}
                <Text style={styles.hintBodyStrong}>
                  never sends, deletes, or changes anything
                </Text>
                . Your inbox stays yours.
              </Trans>
            </Text>
            <TouchableOpacity
              style={[styles.hintButton, gmailConnecting && styles.hintButtonDisabled]}
              onPress={() => void connectGmail(() => connectionQuery.refetch())}
              disabled={gmailConnecting}
            >
              {gmailConnecting ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.hintButtonText}>
                  <Trans>Connect Gmail</Trans>
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ThreadListView
          threads={triage.filteredThreads}
          emptyText={emptyText}
          backfilling={syncStatusQuery.data?.backfillStatus === 'RUNNING'}
          onRefresh={triage.refresh}
          onThreadPress={handleThreadPress}
          onToggleImportant={triage.handleToggleImportant}
          hasMore={triage.hasMore}
          loadingMore={triage.loadingMore}
          onLoadMore={triage.loadMore}
          total={triage.filteredTotal}
          listHeader={
            <>
              <BackfillBanner syncStatus={syncStatusQuery.data} />
              <PlanCapBanner
                syncStatus={syncStatusQuery.data}
                dismissed={planCapDismissed}
                onDismiss={() => setPlanCapDismissed(true)}
              />
            </>
          }
        />
      )}

      <FolderFilterSheet
        visible={folderSheetOpen}
        active={triage.active}
        folders={triage.folders}
        threads={triage.threads}
        onSelectFolder={handleSelectFolder}
        onSelectAll={handleClearFolder}
        onClose={() => setFolderSheetOpen(false)}
      />

      <Toast
        toast={triage.toast}
        onUndo={() => {
          triage.toast?.onUndo?.();
          triage.dismissToast();
        }}
        onDismiss={triage.dismissToast}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  searchInput: {
    backgroundColor: colors.bgSunk,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    fontSize: fontSize.md,
    color: colors.ink,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  folderRowText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.ink3,
  },
  folderRowChevron: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  hintContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  hint: {
    padding: space.xl,
    gap: space.md,
    backgroundColor: colors.surface,
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  hintTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    textAlign: 'center',
  },
  hintBody: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
  },
  hintBodyStrong: {
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  hintButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.xxl,
    alignItems: 'center',
    marginTop: space.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  hintButtonDisabled: {
    opacity: 0.6,
  },
  hintButtonText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
