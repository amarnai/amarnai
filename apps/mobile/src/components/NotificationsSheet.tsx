import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { NotificationItem } from '@amarnai/api-client';
import { useSession } from '../auth/session';
import { describeNotification } from '../data/notificationView';
import { SheetLayout } from './SheetLayout';

interface NotificationsSheetProps {
  visible: boolean;
  items: NotificationItem[];
  loading: boolean;
  onClose: () => void;
  // Opens the full notifications manager (the "Manage notifications" CTA).
  onManage: () => void;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function NotificationsSheet({ visible, items, loading, onClose, onManage }: NotificationsSheetProps) {
  const { i18n } = useLingui();
  const router = useRouter();
  const { workspaceId, switchWorkspace } = useSession();

  function openNotification(n: NotificationItem) {
    const threadId = str(n.params['threadId']);
    onClose();
    if (!threadId) return;
    // Deep-link into the right workspace: switch first when the notification
    // belongs to a different one than the active workspace.
    if (n.workspaceId !== workspaceId) {
      switchWorkspace(n.workspaceId);
    }
    router.push(`/thread/${threadId}`);
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Notifications`)} handle>
      <FlatList
        style={styles.list}
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => openNotification(item)}>
            <Text style={[styles.rowText, !item.readAt && styles.rowTextUnread]} numberOfLines={2}>
              {describeNotification(item, i18n).title}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {loading ? <Trans>Loading…</Trans> : <Trans>No notifications yet</Trans>}
          </Text>
        }
      />
      <TouchableOpacity style={styles.manage} onPress={onManage} activeOpacity={0.7}>
        <Text style={styles.manageText}>
          <Trans>Manage notifications</Trans>
        </Text>
      </TouchableOpacity>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  list: {
    flexShrink: 1,
  },
  row: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  rowText: {
    fontSize: fontSize.md,
    color: colors.ink2,
  },
  rowTextUnread: {
    color: colors.ink,
    fontWeight: fontWeight.medium,
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
  manage: {
    paddingVertical: space.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  manageText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accentInk,
  },
});
