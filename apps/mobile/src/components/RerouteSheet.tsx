import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { FolderItem } from '@amarnai/core';
import { BottomSheet } from './BottomSheet';

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
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Move to folder</Text>
        <FlatList
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
                {isCurrent ? <Text style={styles.currentTag}>Current</Text> : null}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No folders available</Text>}
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
