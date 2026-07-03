import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, fontSize, fontWeight, radii, space } from '@amarnai/tokens';
import type { NotificationItem } from '@amarnai/api-client';
import { useSession } from '../../src/auth/session';
import { describeNotification } from '../../src/data/notificationView';
import { ScreenContainer } from '../../src/components/ScreenContainer';

const PAGE_SIZE = 30;

// Full notifications page (a pushed screen — the list is one route; individual
// notifications never get their own route). Rows carry a collapsible body,
// inline actions (mark read/unread, open thread, delete), and a multi-select
// mode for batch mark/delete. Mirrors the web notifications page.
export default function NotificationsScreen() {
  const { i18n } = useLingui();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, workspaceId, switchWorkspace } = useSession();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    client
      .notifications(undefined, PAGE_SIZE)
      .then(({ notifications, nextCursor }) => {
        if (cancelled) return;
        setItems(notifications);
        setNextCursor(nextCursor);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    client
      .notifications(nextCursor, PAGE_SIZE)
      .then(({ notifications, nextCursor }) => {
        setItems((prev) => [...prev, ...notifications]);
        setNextCursor(nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [client, nextCursor, loadingMore]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((n) => n.id)));
  }

  function enterSelectMode(seedId?: string) {
    setSelectMode(true);
    if (seedId) setSelected(new Set([seedId]));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  // ── Mutations (optimistic; server call best-effort) ──────────────────────────

  function applyRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    const at = read ? new Date().toISOString() : null;
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: at } : n)));
    setBusy(true);
    client
      .updateNotifications(ids, read)
      .catch(() => {})
      .finally(() => setBusy(false));
    if (selectMode) exitSelectMode();
  }

  function performDelete(ids: string[]) {
    const idSet = new Set(ids);
    setItems((prev) => prev.filter((n) => !idSet.has(n.id)));
    setBusy(true);
    client
      .deleteNotifications(ids)
      .catch(() => {})
      .finally(() => setBusy(false));
    if (selectMode) exitSelectMode();
  }

  function confirmDelete(ids: string[]) {
    if (ids.length === 0) return;
    const message =
      ids.length === 1
        ? i18n._(msg`Delete this notification?`)
        : i18n._(msg`Delete ${ids.length} notifications?`);
    Alert.alert(i18n._(msg`Delete notifications`), message, [
      { text: i18n._(msg`Cancel`), style: 'cancel' },
      { text: i18n._(msg`Delete`), style: 'destructive', onPress: () => performDelete(ids) },
    ]);
  }

  function openThread(n: NotificationItem, threadId: string) {
    if (!n.readAt) applyRead([n.id], true);
    if (n.workspaceId !== workspaceId) switchWorkspace(n.workspaceId);
    router.push(`/thread/${threadId}`);
  }

  const selectedIds = Array.from(selected);
  const selectedCount = selected.size;

  function renderRow(n: NotificationItem) {
    const view = describeNotification(n, i18n);
    const isUnread = !n.readAt;
    const isExpanded = expanded.has(n.id);
    const isSelected = selected.has(n.id);

    return (
      <View style={[styles.row, isSelected && styles.rowSelected]}>
        <TouchableOpacity
          style={styles.rowMain}
          activeOpacity={0.7}
          onPress={() => {
            if (selectMode) toggleSelected(n.id);
            else if (view.body) toggleExpanded(n.id);
          }}
          onLongPress={() => !selectMode && enterSelectMode(n.id)}
        >
          {selectMode ? (
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isSelected ? colors.accent : colors.ink4}
              style={styles.rowLeadIcon}
            />
          ) : view.body ? (
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={colors.ink4}
              style={styles.rowLeadIcon}
            />
          ) : (
            <View style={styles.rowLeadSpacer} />
          )}

          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <Text style={[styles.rowTitle, isUnread && styles.rowTitleUnread]} numberOfLines={2}>
                {view.title}
              </Text>
              {isUnread ? <View style={styles.unreadDot} /> : null}
            </View>
            {view.body && isExpanded ? <Text style={styles.rowBody}>{view.body}</Text> : null}
          </View>
        </TouchableOpacity>

        {!selectMode ? (
          <View style={styles.rowActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              disabled={busy}
              hitSlop={6}
              onPress={() => applyRead([n.id], isUnread)}
              accessibilityLabel={isUnread ? i18n._(msg`Mark as read`) : i18n._(msg`Mark as unread`)}
            >
              <Ionicons
                name={isUnread ? 'checkmark-outline' : 'ellipse'}
                size={18}
                color={colors.ink3}
              />
            </TouchableOpacity>
            {view.threadId ? (
              <TouchableOpacity
                style={styles.iconBtn}
                hitSlop={6}
                onPress={() => openThread(n, view.threadId!)}
                accessibilityLabel={i18n._(msg`Open thread`)}
              >
                <Ionicons name="open-outline" size={18} color={colors.ink3} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.iconBtn}
              disabled={busy}
              hitSlop={6}
              onPress={() => confirmDelete([n.id])}
              accessibilityLabel={i18n._(msg`Delete`)}
            >
              <Ionicons name="trash-outline" size={18} color={colors.ink3} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          <Trans>Notifications</Trans>
        </Text>
        {items.length > 0 ? (
          <TouchableOpacity onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))} hitSlop={8}>
            <Text style={styles.headerAction}>
              {selectMode ? <Trans>Done</Trans> : <Trans>Select</Trans>}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Select-all bar */}
      {selectMode ? (
        <TouchableOpacity style={styles.selectAllBar} onPress={toggleSelectAll} activeOpacity={0.7}>
          <Ionicons
            name={allSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={allSelected ? colors.accent : colors.ink4}
          />
          <Text style={styles.selectAllText}>
            {selectedCount > 0 ? <Trans>{selectedCount} selected</Trans> : <Trans>Select all</Trans>}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => renderRow(item)}
          contentContainerStyle={items.length === 0 ? styles.listEmptyContent : undefined}
          ListEmptyComponent={
            <Text style={styles.empty}>
              <Trans>No notifications yet</Trans>
            </Text>
          }
          ListFooterComponent={
            nextCursor ? (
              <TouchableOpacity style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                <Text style={styles.loadMoreText}>
                  {loadingMore ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
                </Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* Batch action bar */}
      {selectMode && selectedCount > 0 ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + space.md }]}>
          <TouchableOpacity style={styles.actionBtn} disabled={busy} onPress={() => applyRead(selectedIds, true)}>
            <Text style={styles.actionBtnText}>
              <Trans>Mark read</Trans>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} disabled={busy} onPress={() => applyRead(selectedIds, false)}>
            <Text style={styles.actionBtnText}>
              <Trans>Mark unread</Trans>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} disabled={busy} onPress={() => confirmDelete(selectedIds)}>
            <Text style={[styles.actionBtnText, styles.actionBtnDanger]}>
              <Trans>Delete</Trans>
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  back: {
    paddingVertical: space.xxs,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  headerAction: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accentInk,
  },
  selectAllBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  selectAllText: {
    fontSize: fontSize.md,
    color: colors.ink2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listEmptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    paddingVertical: space.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowSelected: {
    backgroundColor: colors.accentSoft,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  rowLeadIcon: {
    marginTop: 1,
  },
  rowLeadSpacer: {
    width: 16,
  },
  rowText: {
    flex: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: fontSize.md,
    color: colors.ink2,
  },
  rowTitleUnread: {
    color: colors.ink,
    fontWeight: fontWeight.medium,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  rowBody: {
    marginTop: space.sm,
    padding: space.md,
    fontSize: fontSize.base,
    color: colors.ink3,
    backgroundColor: colors.bgSoft,
    borderRadius: radii.sm,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginLeft: space.sm,
  },
  iconBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMore: {
    margin: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  loadMoreText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink2,
  },
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    backgroundColor: colors.surface,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink2,
  },
  actionBtnDanger: {
    color: colors.danger,
  },
});
