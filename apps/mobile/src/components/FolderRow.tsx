import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';
import type { FolderItem } from '@aziru/core';

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
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  name: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.medium,
    color: colors.ink,
    flex: 1,
  },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    minWidth: space.xxl,
    height: space.xxl,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: space.md,
  },
  badgeText: {
    color: colors.surface,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
