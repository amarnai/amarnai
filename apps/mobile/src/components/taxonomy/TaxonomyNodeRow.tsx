import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { TaxonomyTreeRow } from '../../taxonomy/buildTree';

interface TaxonomyNodeRowProps {
  row: TaxonomyTreeRow;
  collapsed: boolean;
  // When true the chevron is hidden (search results render as a flat list).
  flat?: boolean;
  onToggle: () => void;
  onPress: () => void;
}

const INDENT_STEP = space.xl;

export function TaxonomyNodeRow({ row, collapsed, flat, onToggle, onPress }: TaxonomyNodeRowProps) {
  const { node, depth, hasChildren, ignored } = row;
  const indent = flat ? 0 : depth * INDENT_STEP;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.6}>
      <View style={[styles.lead, { width: indent }]} />
      {hasChildren && !flat ? (
        <TouchableOpacity onPress={onToggle} hitSlop={10} style={styles.chevron}>
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={16}
            color={colors.ink3}
          />
        </TouchableOpacity>
      ) : (
        <View style={styles.chevron} />
      )}

      <Text style={[styles.name, node.isRoot && styles.nameRoot]} numberOfLines={1}>
        {node.name}
      </Text>

      {node.isRoot ? (
        <View style={[styles.tag, styles.tagEntry]}>
          <Text style={[styles.tagText, styles.tagEntryText]}>Entry</Text>
        </View>
      ) : ignored ? (
        <View style={[styles.tag, styles.tagIgnored]}>
          <Text style={[styles.tagText, styles.tagIgnoredText]}>Ignored</Text>
        </View>
      ) : null}

      {node.threadCount > 0 ? (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{node.threadCount}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  lead: {
    height: 1,
  },
  chevron: {
    width: space.xxl,
    alignItems: 'center',
  },
  name: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    color: colors.ink,
  },
  nameRoot: {
    fontWeight: fontWeight.semibold,
  },
  tag: {
    borderRadius: radii.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    marginLeft: space.sm,
  },
  tagText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  tagEntry: {
    backgroundColor: colors.accentSoft,
  },
  tagEntryText: {
    color: colors.accentInk,
  },
  tagIgnored: {
    backgroundColor: colors.warnSoft,
  },
  tagIgnoredText: {
    color: colors.warnInk,
  },
  countBadge: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    minWidth: space.xxl,
    height: space.xxl,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.xs,
    marginLeft: space.sm,
  },
  countText: {
    color: colors.surface,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
