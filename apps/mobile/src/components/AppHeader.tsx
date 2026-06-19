import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { useSession } from '../auth/session';
import { WorkspaceMark } from './WorkspaceMark';
import { WorkspacePicker } from './WorkspacePicker';
import { NewWorkspaceSheet } from './NewWorkspaceSheet';

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
  const { workspaceId, workspaces, switchWorkspace } = useSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);

  const active = workspaces.find((w) => w.id === workspaceId) ?? null;

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
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
});
