import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, space, fontSize } from '@amarnai/tokens';
import type { FolderItem } from '@amarnai/core';
import { SheetLayout } from './SheetLayout';

interface RerouteSheetProps {
  visible: boolean;
  folders: FolderItem[];
  currentFolderId: string | null;
  onSelect: (folderId: string) => void;
  onClose: () => void;
}

// Bottom sheet for picking a target folder. Reuses triage.folders; selecting a
// folder calls back into triage.commitReroute via onSelect. Readonly: this only
// changes Amarnai's routing, never Gmail.
export function RerouteSheet({
  visible,
  folders,
  currentFolderId,
  onSelect,
  onClose,
}: RerouteSheetProps) {
  const { i18n } = useLingui();
  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Move to folder`)} handle>
      <FlatList
        style={styles.list}
        data={folders}
        keyExtractor={(f) => f.id}
        renderItem={({ item }) => {
          const isCurrent = item.id === currentFolderId;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onSelect(item.id)}
              disabled={isCurrent}
            >
              <Text style={[styles.rowText, isCurrent && styles.rowTextCurrent]}>
                {item.name}
              </Text>
              {isCurrent ? <Text style={styles.currentTag}><Trans>Current</Trans></Text> : null}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}><Trans>No folders available</Trans></Text>}
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
  },
  rowTextCurrent: {
    color: colors.ink4,
  },
  currentTag: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  empty: {
    fontSize: fontSize.md,
    color: colors.ink3,
    textAlign: 'center',
    paddingVertical: space.xl,
  },
});
