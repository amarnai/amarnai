import { useRouter } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildFolderCounts } from '@amarnai/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useTriage } from '../../../../src/triage/TriageProvider';
import { FolderRow } from '../../../../src/components/FolderRow';
import { AppHeader } from '../../../../src/components/AppHeader';
import { useSession } from '../../../../src/auth/session';
import { useGmailConnection } from '../../../../src/data/queries';
import { WEB_APP_URL } from '../../../../src/config';

export default function EmailsScreen() {
  const router = useRouter();
  const triage = useTriage();
  const { workspaceId } = useSession();

  const folderCounts = buildFolderCounts(triage.threads, triage.folders);

  // Connecting Gmail is a web-only flow, so a fresh account (verified, default
  // workspace, no connection) has nothing to triage yet. Once the query resolves
  // without an active connection, point the user to the web app.
  const connectionQuery = useGmailConnection(workspaceId ?? '');
  const showConnectHint =
    connectionQuery.isSuccess && connectionQuery.data?.status !== 'ACTIVE';

  const handleFolderPress = (folderId: string) => {
    triage.setActive({ kind: 'folder', id: folderId });
    router.push({ pathname: '/(app)/folder/[nodeId]', params: { nodeId: folderId } });
  };

  return (
    <View style={styles.container}>
      <AppHeader variant="workspace" />
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.sectionTitle}>Folders</Text>
        {triage.folders.length === 0 ? (
          showConnectHint ? (
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
              <Text style={styles.hintUrl} numberOfLines={1}>
                {WEB_APP_URL}
              </Text>
            </View>
          ) : (
            <Text style={styles.empty}>No folders yet</Text>
          )
        ) : (
          triage.folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              count={folderCounts.get(folder.id)}
              onPress={() => handleFolderPress(folder.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: space.xl,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    textTransform: 'uppercase',
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: space.xxl,
  },
  hint: {
    marginTop: space.xxl,
    marginHorizontal: space.xl,
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
