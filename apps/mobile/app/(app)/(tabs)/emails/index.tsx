import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Linking,
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
import { Toast } from '../../../../src/components/Toast';
import { QueueChips } from '../../../../src/components/emails/QueueChips';
import { FolderFilterSheet } from '../../../../src/components/emails/FolderFilterSheet';
import { ThreadListView } from '../../../../src/components/emails/ThreadListView';
import { UnroutedBanner } from '../../../../src/components/emails/UnroutedBanner';
import { useSession } from '../../../../src/auth/session';
import { useGmailConnection } from '../../../../src/data/queries';
import { WEB_APP_URL } from '../../../../src/config';

export default function EmailsScreen() {
  const router = useRouter();
  const triage = useTriage();
  const { workspaceId } = useSession();

  const [folderSheetOpen, setFolderSheetOpen] = useState(false);

  // Keep a stable ref so the focus callback never captures a stale `refresh`.
  const refreshRef = useRef(triage.refresh);
  refreshRef.current = triage.refresh;

  // Refresh each time the tab regains focus — replaces web's EventSource SSE.
  useFocusEffect(
    useCallback(() => {
      refreshRef.current();
    }, []),
  );

  // When Gmail isn't connected yet the inbox is empty. Point new users to the
  // web app where the OAuth connection flow lives.
  const connectionQuery = useGmailConnection(workspaceId ?? '');
  const showConnectHint =
    connectionQuery.isSuccess && connectionQuery.data?.status !== 'ACTIVE';

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
    <View style={styles.container}>
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
              Connect your Gmail account on the web to sync your inbox into Amarnai.
            </Text>
            <TouchableOpacity
              style={styles.hintButton}
              onPress={() => Linking.openURL(WEB_APP_URL)}
            >
              <Text style={styles.hintButtonText}>Open the web app</Text>
            </TouchableOpacity>
            <Text style={styles.hintUrl} numberOfLines={1}>{WEB_APP_URL}</Text>
          </View>
        </View>
      ) : (
        <ThreadListView
          threads={triage.filteredThreads}
          emptyText={emptyText}
          onRefresh={triage.refresh}
          onThreadPress={handleThreadPress}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
  },
  hintButtonText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  hintUrl: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
});
