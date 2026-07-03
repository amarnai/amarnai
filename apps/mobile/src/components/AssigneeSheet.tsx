import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, space, fontSize } from '@amarnai/tokens';
import type { MemberItem } from '@amarnai/core/emails';
import { SheetLayout } from './SheetLayout';

interface AssigneeSheetProps {
  visible: boolean;
  members: MemberItem[];
  currentAssigneeId: string | null;
  /** userId to assign, or null to unassign. */
  onSelect: (userId: string | null) => void;
  onClose: () => void;
}

// Bottom sheet for picking an assignee. Mirrors RerouteSheet. An "Unassign" row
// appears at the top only when the thread is currently assigned.
export function AssigneeSheet({
  visible,
  members,
  currentAssigneeId,
  onSelect,
  onClose,
}: AssigneeSheetProps) {
  const { i18n } = useLingui();

  // Rows: an optional Unassign entry (userId null) followed by each member.
  const rows: Array<{ key: string; userId: string | null; label: string }> = [];
  if (currentAssigneeId) {
    rows.push({ key: '__unassign__', userId: null, label: i18n._(msg`Unassign`) });
  }
  for (const m of members) {
    rows.push({ key: m.userId, userId: m.userId, label: m.name ?? m.email });
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Assign to`)} handle>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) => {
          const isCurrent = item.userId !== null && item.userId === currentAssigneeId;
          const isUnassign = item.userId === null;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onSelect(item.userId)}
              disabled={isCurrent}
            >
              <Text
                style={[
                  styles.rowText,
                  isUnassign && styles.rowTextUnassign,
                  isCurrent && styles.rowTextCurrent,
                ]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
              {isCurrent ? <Text style={styles.currentTag}><Trans>Current</Trans></Text> : null}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}><Trans>No members available</Trans></Text>}
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
    flexShrink: 1,
  },
  rowTextUnassign: {
    color: colors.ink3,
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
