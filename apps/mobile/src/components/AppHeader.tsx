import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useSession } from '../auth/session';
import { useNotifications } from '../data/useNotifications';
import { WorkspaceMark } from './WorkspaceMark';
import { WorkspacePicker } from './WorkspacePicker';
import { NewWorkspaceSheet } from './NewWorkspaceSheet';
import { NotificationsSheet } from './NotificationsSheet';

type AppHeaderProps = { variant: 'workspace' } | { variant: 'title'; title: string };

// Persistent top bar. The `workspace` variant shows the active workspace as a
// tappable switcher (the one piece of context that must stay visible across the
// workspace-scoped tabs); the `title` variant shows a plain screen heading. Both
// pad for the status bar / notch via the top safe-area inset.
export function AppHeader(props: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const paddingTop = insets.top + space.md;

  if (props.variant === 'title') {
    return (
      <View style={[styles.bar, { paddingTop }]}>
        <Text style={styles.title} numberOfLines={1}>
          {props.title}
        </Text>
      </View>
    );
  }

  return <WorkspaceHeader paddingTop={paddingTop} />;
}

function WorkspaceHeader({ paddingTop }: { paddingTop: number }) {
  const router = useRouter();
  const { workspaceId, workspaces, switchWorkspace } = useSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { unread, items, loading, load, markAllRead, dismiss } = useNotifications();

  const active = workspaces.find((w) => w.id === workspaceId) ?? null;

  function openNotifications() {
    load();
    markAllRead();
    setNotificationsOpen(true);
  }

  return (
    <View style={[styles.bar, { paddingTop }]}>
      <TouchableOpacity
        style={styles.switcher}
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch workspace"
        hitSlop={8}
      >
        <WorkspaceMark name={active?.name ?? '?'} size={28} />
        <Text style={styles.switcherName} numberOfLines={1}>
          {active?.name ?? 'No workspace'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.ink3} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.bellBtn}
        onPress={openNotifications}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
        hitSlop={8}
      >
        <Ionicons name="notifications-outline" size={22} color={colors.ink2} />
        {unread > 0 ? (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      <NotificationsSheet
        visible={notificationsOpen}
        items={items}
        loading={loading}
        onClose={() => setNotificationsOpen(false)}
        onDismiss={dismiss}
        onManage={() => {
          setNotificationsOpen(false);
          router.push('/notifications');
        }}
      />

      <WorkspacePicker
        visible={pickerOpen}
        workspaces={workspaces}
        currentWorkspaceId={workspaceId}
        onSelect={(id) => {
          switchWorkspace(id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        onCreateNew={() => {
          setPickerOpen(false);
          setNewWorkspaceOpen(true);
        }}
      />

      <NewWorkspaceSheet
        visible={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    backgroundColor: colors.bg,
  },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flex: 1,
  },
  switcherName: {
    flexShrink: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  bellBtn: {
    marginLeft: space.md,
    padding: space.xs,
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: fontWeight.semibold,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
});
