import { useCallback, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { groupThreadsByDate, type ThreadItem } from '@amarnai/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { ThreadRow } from '../ThreadRow';
import { DATE_SECTION_LABELS } from './queueLabels';

interface ThreadListViewProps {
  threads: ThreadItem[];
  emptyText?: string;
  // True while the historical backfill is still fetching past threads from
  // Gmail. When the list is empty because of this, show a loading state with a
  // spinner instead of the empty message.
  backfilling?: boolean;
  onRefresh: () => Promise<void>;
  onThreadPress: (threadId: string) => void;
  onToggleImportant: (threadId: string) => void;
  // Rendered inside the scroll area, above the threads, so it scrolls with the
  // list rather than staying pinned above it.
  listHeader?: ReactElement | null;
  // Pagination: fetch the next page when the list end is reached, plus an
  // explicit Load more button and an "X of Y loaded" count. `total` is the
  // server's inbox-visible thread count.
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  total?: number;
}

export function ThreadListView({
  threads,
  emptyText,
  backfilling,
  onRefresh,
  onThreadPress,
  onToggleImportant,
  listHeader,
  hasMore,
  loadingMore,
  onLoadMore,
  total,
}: ThreadListViewProps) {
  const { i18n } = useLingui();
  const [refreshing, setRefreshing] = useState(false);
  const resolvedEmptyText = emptyText ?? i18n._(msg`No threads`);

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
        <ThreadRow
          thread={item}
          onPress={() => onThreadPress(item.id)}
          onToggleImportant={() => onToggleImportant(item.id)}
        />
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>
            {DATE_SECTION_LABELS[section.label]
              ? i18n._(DATE_SECTION_LABELS[section.label]!)
              : section.label}
          </Text>
        </View>
      )}
      ListHeaderComponent={listHeader ?? null}
      ListFooterComponent={
        hasMore && threads.length > 0 ? (
          <View style={styles.footer}>
            <Text style={styles.footerCount}>
              <Trans>
                {threads.length.toLocaleString()} of{' '}
                {(total ?? 0).toLocaleString()} loaded
              </Trans>
            </Text>
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator color={colors.ink3} size="small" />
              ) : (
                <Text style={styles.loadMoreText}>
                  <Trans>Load more</Trans>
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null
      }
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
          {backfilling ? (
            <View style={styles.emptyLoading}>
              <ActivityIndicator color={colors.ink3} size="small" />
              <Text style={styles.emptyText}>
                <Trans>Loading past threads…</Trans>
              </Text>
            </View>
          ) : (
            <Text style={styles.emptyText}>{resolvedEmptyText}</Text>
          )}
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
    // Fill the space left below the list header and center the message within
    // it. The centering lives here (not on emptyContent) so the header banners
    // stay pinned at the top and stretch full-width; putting justify/align on
    // the content container would center AND shrink the headers to their text
    // width, clipping them mid-screen.
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
  },
  emptyContent: {
    flexGrow: 1,
  },
  footer: {
    paddingVertical: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  footerCount: {
    fontSize: fontSize.xs,
    color: colors.ink3,
  },
  loadMoreBtn: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.bgSunk,
  },
  loadMoreText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.ink,
  },
});
