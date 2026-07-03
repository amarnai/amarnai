import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  // Drop a notification from the pop-up feed (dismiss). The row stays on the
  // full notifications page.
  onDismiss: (id: string) => void;
  // Opens the full notifications manager (the "Manage notifications" CTA).
  onManage: () => void;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function NotificationsSheet({ visible, items, loading, onClose, onDismiss, onManage }: NotificationsSheetProps) {
  const { i18n } = useLingui();
  const router = useRouter();
  const { workspaceId, switchWorkspace } = useSession();

  function openNotification(n: NotificationItem) {
    const threadId = str(n.params['threadId']);
    // Clicking through deals with it: dismiss so it won't reappear in the pop-up.
    onDismiss(n.id);
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
          <View style={styles.row}>
            <TouchableOpacity style={styles.rowMain} onPress={() => openNotification(item)}>
              <Text style={[styles.rowText, !item.readAt && styles.rowTextUnread]} numberOfLines={2}>
                {describeNotification(item, i18n).title}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissBtn}
              hitSlop={8}
              onPress={() => onDismiss(item.id)}
              accessibilityLabel={i18n._(msg`Dismiss`)}
            >
              <Ionicons name="close" size={18} color={colors.ink4} />
            </TouchableOpacity>
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  rowMain: {
    flex: 1,
    paddingLeft: space.xl,
    paddingRight: space.md,
    paddingVertical: space.lg,
  },
  dismissBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    alignSelf: 'stretch',
    justifyContent: 'center',
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
