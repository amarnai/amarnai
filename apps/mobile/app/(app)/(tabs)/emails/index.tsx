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
import type { QueueId } from '@amarnai/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useTriage } from '../../../../src/triage/TriageProvider';
import { AppHeader } from '../../../../src/components/AppHeader';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { Toast } from '../../../../src/components/Toast';
import { QueueChips } from '../../../../src/components/emails/QueueChips';
import { FolderFilterSheet } from '../../../../src/components/emails/FolderFilterSheet';
import { ThreadListView } from '../../../../src/components/emails/ThreadListView';
import { UnroutedBanner } from '../../../../src/components/emails/UnroutedBanner';
import { BackfillBanner } from '../../../../src/components/emails/BackfillBanner';
import { useSession } from '../../../../src/auth/session';
import { useGmailConnection, useSyncStatus } from '../../../../src/data/queries';
import { useConnectGmail } from '../../../../src/auth/useConnectGmail';

export default function EmailsScreen() {
  const router = useRouter();
  const triage = useTriage();
  const { workspaceId, client } = useSession();

  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [backfillDismissed, setBackfillDismissed] = useState(false);

  // Keep a stable ref so the focus callback never captures a stale `refresh`.
  const refreshRef = useRef(triage.refresh);
  refreshRef.current = triage.refresh;

  // Refresh each time the tab regains focus — replaces web's EventSource SSE.
  useFocusEffect(
    useCallback(() => {
      refreshRef.current();
    }, []),
  );

  // When Gmail isn't connected, show an in-app connect CTA instead of the
  // thread list. On success, invalidate the connection query so the empty
  // state clears and the first sync results appear.
  const connectionQuery = useGmailConnection(workspaceId ?? '');
  const syncStatusQuery = useSyncStatus(workspaceId ?? '');
  const showConnectHint =
    connectionQuery.isSuccess && connectionQuery.data?.status !== 'ACTIVE';
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
    triage.handleReroute();
    triage.markWaitingClassifying();
  };

  const activeFolderName =
    triage.active.kind === 'folder'
      ? (triage.folders.find((f) => f.id === triage.active.id)?.name ?? 'Folder')
      : null;

  const emptyText =
    triage.query
      ? 'No threads match your search'
      : triage.active.kind === 'folder'
        ? `No threads in ${activeFolderName}`
        : 'No threads yet';

  return (
    <ScreenContainer>
      <AppHeader variant="workspace" />

      <QueueChips
        active={triage.active}
        threads={triage.threads}
        folders={triage.folders}
        onSelectQueue={handleSelectQueue}
        onClearFolder={handleClearFolder}
      />

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search threads…"
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
          {activeFolderName ? `Folder: ${activeFolderName}` : 'All folders'}
        </Text>
        <Text style={styles.folderRowChevron}>▾</Text>
      </TouchableOpacity>

      <UnroutedBanner
        waitingCount={triage.waitingCount}
        routableFolderCount={triage.folders.length}
        onRouteNow={handleRouteNow}
      />

      {showConnectHint && triage.threads.length === 0 ? (
        <View style={styles.hintContainer}>
          <View style={styles.hint}>
            <Text style={styles.hintTitle}>Connect Gmail to start triaging</Text>
            <Text style={styles.hintBody}>
              Connect your Gmail account to sync your inbox into Amarnai.
            </Text>
            <TouchableOpacity
              style={[styles.hintButton, gmailConnecting && styles.hintButtonDisabled]}
              onPress={() => void connectGmail(() => connectionQuery.refetch())}
              disabled={gmailConnecting}
            >
              {gmailConnecting ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.hintButtonText}>Connect Gmail</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ThreadListView
          threads={triage.filteredThreads}
          emptyText={emptyText}
          onRefresh={triage.refresh}
          onThreadPress={handleThreadPress}
          listHeader={
            <BackfillBanner
              syncStatus={syncStatusQuery.data}
              dismissed={backfillDismissed}
              onDismiss={() => setBackfillDismissed(true)}
            />
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
