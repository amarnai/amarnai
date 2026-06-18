import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildFolderCounts } from '@amarnai/core';
import { colors, radii } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import { useTriage } from '../../src/triage/TriageProvider';
import { FolderRow } from '../../src/components/FolderRow';

export default function HomeScreen() {
  const { signOut } = useSession();
  const triage = useTriage();

  const folderCounts = buildFolderCounts(triage.threads, triage.folders);

  // Slice 2 sets the active folder on tap; Slice 3 adds the folder/[nodeId]
  // thread-list route and wires navigation here.
  const handleFolderPress = (folderId: string) => {
    triage.setActive({ kind: 'folder', id: folderId });
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
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink3,
    paddingHorizontal: 16,
    paddingBottom: 8,
    textTransform: 'uppercase',
  },
  empty: {
    fontSize: 14,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: 24,
  },
  signOut: {
    marginHorizontal: 16,
    marginBottom: 24,
    borderColor: colors.line2,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  signOutText: {
    fontSize: 15,
    color: colors.ink2,
    fontWeight: '500',
    textAlign: 'center',
  },
});
