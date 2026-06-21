import { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { TaxonomyTemplate } from '@amarnai/core/taxonomy';
import type { TaxonomyTransferFile } from '@amarnai/shared';
import { SheetLayout } from '../SheetLayout';

interface TemplatePickerSheetProps {
  visible: boolean;
  templates: TaxonomyTemplate[];
  // The template that matches the current taxonomy, shown as "Current" and not
  // selectable (re-applying it would be a no-op replace).
  currentTemplateId: string | null;
  applying: boolean;
  onApply: (file: TaxonomyTransferFile) => void;
  onClose: () => void;
}

// Lists starter taxonomies. Applying one replaces the current taxonomy, so a
// confirm step is always shown before the destructive import.
export function TemplatePickerSheet({
  visible,
  templates,
  currentTemplateId,
  applying,
  onApply,
  onClose,
}: TemplatePickerSheetProps) {
  const [selected, setSelected] = useState<TaxonomyTemplate | null>(null);

  function close() {
    setSelected(null);
    onClose();
  }

  return (
    <SheetLayout visible={visible} onClose={close} title="Start from a template" handle>
      {selected ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmText}>
            Apply "{selected.name}"? This replaces your current taxonomy.
          </Text>
          <View style={styles.confirmRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => setSelected(null)}
              disabled={applying}
            >
              <Text style={styles.btnGhostText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onApply(selected.file)}
              disabled={applying}
            >
              <Text style={styles.btnPrimaryText}>
                {applying ? 'Applying...' : 'Apply template'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={templates}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => {
            const categories = item.file.nodes.filter((n) => !n.isRoot).length;
            const isCurrent = item.id === currentTemplateId;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setSelected(item)}
                disabled={isCurrent}
              >
                <View style={styles.rowHead}>
                  <Text style={[styles.name, isCurrent && styles.nameDisabled]}>
                    {item.name}
                  </Text>
                  {isCurrent ? <Text style={styles.currentTag}>Current</Text> : null}
                </View>
                <Text
                  style={[styles.desc, isCurrent && styles.descDisabled]}
                  numberOfLines={2}
                >
                  {item.description}
                </Text>
                <Text style={styles.count}>{categories} categories</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  list: {
    flexShrink: 1,
  },
  row: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    gap: space.xxs,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  nameDisabled: {
    color: colors.ink4,
  },
  currentTag: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    backgroundColor: colors.bgSunk,
    borderRadius: radii.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    overflow: 'hidden',
  },
  desc: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  descDisabled: {
    color: colors.ink4,
  },
  count: {
    fontSize: fontSize.xs,
    color: colors.ink4,
    marginTop: space.xxs,
  },
  confirm: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    gap: space.lg,
  },
  confirmText: {
    fontSize: fontSize.md,
    color: colors.ink,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  btn: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnPrimaryText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  btnGhost: {
    backgroundColor: colors.bgSunk,
  },
  btnGhostText: {
    color: colors.ink2,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
});
