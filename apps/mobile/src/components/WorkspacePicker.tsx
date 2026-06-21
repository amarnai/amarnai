import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { Workspace } from '@amarnai/api-client';
import { WorkspaceMark } from './WorkspaceMark';
import { SheetLayout } from './SheetLayout';

interface WorkspacePickerProps {
  visible: boolean;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onClose: () => void;
  onCreateNew?: () => void;
}

export function WorkspacePicker({
  visible,
  workspaces,
  currentWorkspaceId,
  onSelect,
  onClose,
  onCreateNew,
}: WorkspacePickerProps) {
  return (
    <SheetLayout visible={visible} onClose={onClose} title="Workspaces" handle>
      <FlatList
        style={styles.list}
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
