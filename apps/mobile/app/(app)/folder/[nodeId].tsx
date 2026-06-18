import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useTriage } from '../../../src/triage/TriageProvider';
import { ThreadRow } from '../../../src/components/ThreadRow';

export default function FolderThreadsScreen() {
  const router = useRouter();
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const triage = useTriage();
  const { setActive, refresh, setSelectedId } = triage;

  const [refreshing, setRefreshing] = useState(false);

  // Make the screen self-contained: drive the shared view-model's active
  // selection from the route param, so filteredThreads reflects this folder even
  // when reached by back navigation or a deep link (not only via a folder tap).
  useEffect(() => {
    setActive({ kind: 'folder', id: nodeId });
  }, [nodeId, setActive]);

  const folderName = triage.folders.find((f) => f.id === nodeId)?.name ?? 'Folder';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Slice 3 selects the thread on tap; Slice 4 adds the thread/[threadId] detail
  // route and wires navigation here.
  const handleThreadPress = (threadId: string) => {
    setSelectedId(threadId);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {folderName}
        </Text>
      </View>

      <FlatList
        style={styles.list}
        data={triage.filteredThreads}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <ThreadRow thread={item} onPress={() => handleThreadPress(item.id)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={<Text style={styles.empty}>No threads in this folder</Text>}
        contentContainerStyle={triage.filteredThreads.length === 0 ? styles.emptyContent : undefined}
      />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    gap: space.lg,
  },
  back: {
    paddingVertical: space.xxs,
  },
  backText: {
    fontSize: fontSize.lg,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    flex: 1,
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
