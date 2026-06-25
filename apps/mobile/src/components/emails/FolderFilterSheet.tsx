import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { buildFolderCounts, type ActiveSelection, type FolderItem, type ThreadItem } from '@amarnai/core';
import { colors, space, fontSize, fontWeight } from '@amarnai/tokens';
import { SheetLayout } from '../SheetLayout';

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
  const { i18n } = useLingui();
  const folderCounts = buildFolderCounts(threads, folders);
  const activeFolderId = active.kind === 'folder' ? active.id : null;

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Filter by folder`)} handle>
      <FlatList
        style={styles.list}
        data={folders}
        keyExtractor={(f) => f.id}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.row}
            onPress={() => { onSelectAll(); onClose(); }}
          >
            <Text style={[styles.rowText, activeFolderId === null && styles.rowTextActive]}>
              <Trans>All threads</Trans>
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
        ListEmptyComponent={<Text style={styles.empty}><Trans>No folders yet</Trans></Text>}
      />
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
