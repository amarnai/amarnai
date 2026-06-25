import { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Trans, Plural } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
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
  const { i18n } = useLingui();
  const [selected, setSelected] = useState<TaxonomyTemplate | null>(null);

  function close() {
    setSelected(null);
    onClose();
  }

  const selectedName = selected?.name ?? '';

  return (
    <SheetLayout
      visible={visible}
      onClose={close}
      title={i18n._(msg`Start from a template`)}
      handle
    >
      {selected ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmText}>
            <Trans>
              Apply &ldquo;{selectedName}&rdquo;? This replaces your current plan.
            </Trans>
          </Text>
          <View style={styles.confirmRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => setSelected(null)}
              disabled={applying}
            >
              <Text style={styles.btnGhostText}>
                <Trans>Back</Trans>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onApply(selected.file)}
              disabled={applying}
            >
              <Text style={styles.btnPrimaryText}>
                {applying ? (
                  <Trans>Applying…</Trans>
                ) : (
                  <Trans>Apply template</Trans>
                )}
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
            const folderCount = item.file.nodes.filter((n) => !n.isRoot).length;
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
                  {isCurrent ? (
                    <Text style={styles.currentTag}>
                      <Trans>Current</Trans>
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={[styles.desc, isCurrent && styles.descDisabled]}
                  numberOfLines={2}
                >
                  {item.description}
                </Text>
                <Text style={styles.count}>
                  <Plural value={folderCount} one="# folder" other="# folders" />
                </Text>
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
