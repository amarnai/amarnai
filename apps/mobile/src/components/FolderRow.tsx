import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@amarnai/tokens';
import type { FolderItem } from '@amarnai/core';

interface FolderRowProps {
  folder: FolderItem;
  count: number | undefined;
  onPress: () => void;
}

export function FolderRow({ folder, count, onPress }: FolderRowProps) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.name}>{folder.name}</Text>
      {count !== undefined && count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  name: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.ink,
    flex: 1,
  },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
