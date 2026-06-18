import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { buildFolderCounts } from '@amarnai/core';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useTriage } from '../../../../src/triage/TriageProvider';
import { FolderRow } from '../../../../src/components/FolderRow';

export default function EmailsScreen() {
  const router = useRouter();
  const triage = useTriage();

  const folderCounts = buildFolderCounts(triage.threads, triage.folders);

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
});
