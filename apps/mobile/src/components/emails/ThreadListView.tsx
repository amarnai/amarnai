import { useCallback, useState, type ReactElement } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { groupThreadsByDate, type ThreadItem } from '@amarnai/core';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { ThreadRow } from '../ThreadRow';

interface ThreadListViewProps {
  threads: ThreadItem[];
  emptyText?: string;
  onRefresh: () => Promise<void>;
  onThreadPress: (threadId: string) => void;
  // Rendered inside the scroll area, above the threads, so it scrolls with the
  // list rather than staying pinned above it.
  listHeader?: ReactElement | null;
}

export function ThreadListView({
  threads,
  emptyText = 'No threads',
  onRefresh,
  onThreadPress,
  listHeader,
}: ThreadListViewProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const sections = groupThreadsByDate(threads);

  return (
    <SectionList
      style={styles.list}
      sections={sections}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => (
        <ThreadRow thread={item} onPress={() => onThreadPress(item.id)} />
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{section.label}</Text>
        </View>
      )}
      ListHeaderComponent={listHeader ?? null}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      }
      stickySectionHeadersEnabled={false}
      contentContainerStyle={threads.length === 0 ? styles.emptyContent : undefined}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  sectionHeader: {
    backgroundColor: colors.bg,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyContainer: {
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
