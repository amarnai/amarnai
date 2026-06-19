import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildFolderCounts, type ActiveSelection, type FolderItem, type ThreadItem } from '@amarnai/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { BottomSheet } from '../BottomSheet';

interface FolderFilterSheetProps {
  visible: boolean;
  active: ActiveSelection;
  folders: FolderItem[];
  threads: ThreadItem[];
  onSelectFolder: (folderId: string) => void;
  onSelectAll: () => void;
  onClose: () => void;
}

export function FolderFilterSheet({
  visible,
  active,
  folders,
  threads,
  onSelectFolder,
  onSelectAll,
  onClose,
}: FolderFilterSheetProps) {
  const folderCounts = buildFolderCounts(threads, folders);
  const activeFolderId = active.kind === 'folder' ? active.id : null;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Filter by folder</Text>

        <FlatList
          data={folders}
          keyExtractor={(f) => f.id}
          ListHeaderComponent={
            <TouchableOpacity
              style={styles.row}
              onPress={() => { onSelectAll(); onClose(); }}
            >
              <Text style={[styles.rowText, activeFolderId === null && styles.rowTextActive]}>
                All threads
              </Text>
              {activeFolderId === null ? <Text style={styles.checkmark}>✓</Text> : null}
            </TouchableOpacity>
          }
          renderItem={({ item }) => {
            const isActive = item.id === activeFolderId;
            const count = folderCounts.get(item.id);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => { onSelectFolder(item.id); onClose(); }}
              >
                <Text style={[styles.rowText, isActive && styles.rowTextActive]} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.rowRight}>
                  {count !== undefined && count > 0 ? (
                    <Text style={styles.count}>{count}</Text>
                  ) : null}
                  {isActive ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No folders yet</Text>}
        />
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
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  rowText: {
    fontSize: fontSize.lg,
    color: colors.ink,
    flex: 1,
    marginRight: space.md,
  },
  rowTextActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  count: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  checkmark: {
    fontSize: fontSize.md,
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
  },
});
