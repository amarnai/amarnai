import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { QUEUES, countForActive, type ActiveSelection, type FolderItem, type QueueId, type ThreadItem } from '@amarnai/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { QUEUE_NAME_LABELS } from './queueLabels';

interface QueueChipsProps {
  active: ActiveSelection;
  threads: ThreadItem[];
  folders: FolderItem[];
  // Server-computed per-queue totals; falls back to counting loaded threads.
  queueCounts?: Partial<Record<QueueId, number>>;
  onSelectQueue: (id: QueueId) => void;
  onClearFolder: () => void;
}

export function QueueChips({ active, threads, folders, queueCounts, onSelectQueue, onClearFolder }: QueueChipsProps) {
  const { i18n } = useLingui();
  const activeFolderName =
    active.kind === 'folder'
      ? (folders.find((f) => f.id === active.id)?.name ?? i18n._(msg`Folder`))
      : null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {activeFolderName ? (
        <TouchableOpacity style={[styles.chip, styles.chipFolder]} onPress={onClearFolder}>
          <Text style={styles.chipFolderText}>✕  {activeFolderName}</Text>
        </TouchableOpacity>
      ) : null}
      {QUEUES.map((q) => {
        const isActive = active.kind === 'queue' && active.id === q.id;
        const count = queueCounts?.[q.id] ?? countForActive(threads, folders, { kind: 'queue', id: q.id });
        const isWarn = !!q.warn && !isActive;
        const isWarnActive = !!q.warn && isActive;

        return (
          <TouchableOpacity
            key={q.id}
            style={[
              styles.chip,
              isActive && !isWarnActive && styles.chipActive,
              isWarn && styles.chipWarn,
              isWarnActive && styles.chipWarnActive,
            ]}
            onPress={() => onSelectQueue(q.id)}
          >
            <Text
              style={[
                styles.chipText,
                isActive && !isWarnActive && styles.chipTextActive,
                isWarn && styles.chipTextWarn,
                isWarnActive && styles.chipTextWarnActive,
              ]}
            >
              {QUEUE_NAME_LABELS[q.id] ? i18n._(QUEUE_NAME_LABELS[q.id]!) : q.name}
              {count > 0 ? `  ${count}` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    gap: space.sm,
  },
  chip: {
    borderRadius: radii.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
    backgroundColor: colors.bgSunk,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipWarn: {
    backgroundColor: colors.warnSoft,
    borderColor: colors.warnLine,
  },
  chipWarnActive: {
    backgroundColor: colors.warnSoft,
    borderColor: colors.warnLine,
  },
  chipFolder: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.ink2,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  chipTextWarn: {
    color: colors.warnInk,
    fontWeight: fontWeight.semibold,
  },
  chipTextWarnActive: {
    color: colors.warnInk,
    fontWeight: fontWeight.semibold,
  },
  chipFolderText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
});
