import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { Workspace } from '@amarnai/api-client';
import { WorkspaceMark } from './WorkspaceMark';
import { BottomSheet } from './BottomSheet';

interface WorkspacePickerProps {
  visible: boolean;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onClose: () => void;
  onCreateNew?: () => void;
}

// Bottom sheet for switching the active workspace. Mirrors RerouteSheet's
// structure; the active workspace is checked and disabled. Switching is a view
// concern (the API is queried per workspace id), so this only calls back via
// onSelect.
export function WorkspacePicker({
  visible,
  workspaces,
  currentWorkspaceId,
  onSelect,
  onClose,
  onCreateNew,
}: WorkspacePickerProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Workspaces</Text>
        <FlatList
          data={workspaces}
          keyExtractor={(w) => w.id}
          renderItem={({ item }) => {
            const isCurrent = item.id === currentWorkspaceId;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => onSelect(item.id)}
                disabled={isCurrent}
              >
                <WorkspaceMark name={item.name} size={24} />
                <Text style={styles.rowText} numberOfLines={1}>
                  {item.name}
                </Text>
                {isCurrent ? (
                  <Ionicons name="checkmark" size={20} color={colors.accent} />
                ) : null}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No workspaces</Text>}
        />
        <TouchableOpacity style={styles.createRow} onPress={onCreateNew}>
          <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
          <Text style={styles.createRowText}>New workspace</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.line3,
    marginBottom: space.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  rowText: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  createRowText: {
    fontSize: fontSize.lg,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
});
