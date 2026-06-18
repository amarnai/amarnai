import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildFolderCounts } from '@amarnai/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { useTriage } from '../../src/triage/TriageProvider';
import { FolderRow } from '../../src/components/FolderRow';

export default function HomeScreen() {
  const router = useRouter();
  const { signOut } = useSession();
  const triage = useTriage();

  const folderCounts = buildFolderCounts(triage.threads, triage.folders);

  // Set the active folder, then open its thread list. The folder screen also
  // sets active from its route param, so deep links and back navigation work too.
  const handleFolderPress = (folderId: string) => {
    triage.setActive({ kind: 'folder', id: folderId });
    router.push({ pathname: '/(app)/folder/[nodeId]', params: { nodeId: folderId } });
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <Text style={styles.sectionTitle}>Folders</Text>
        {triage.folders.length === 0 ? (
          <Text style={styles.empty}>No folders yet</Text>
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

      <TouchableOpacity style={styles.signOut} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
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
  signOut: {
    marginHorizontal: space.xl,
    marginBottom: space.xxl,
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: space.xl + space.xs,
    paddingVertical: space.lg - space.xxs,
  },
  signOutText: {
    fontSize: fontSize.lg,
    color: colors.ink2,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
});
