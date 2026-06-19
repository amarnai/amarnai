import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { BottomSheet } from '../BottomSheet';

export type NodePickerOption = {
  // `null` id is the "none" choice (no parent / leave unsorted).
  id: string | null;
  label: string;
  sublabel?: string;
  disabled?: boolean;
};

interface NodePickerSheetProps {
  visible: boolean;
  title: string;
  options: NodePickerOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

// Generic single-choice node picker (modeled on RerouteSheet). Reused for the
// node form's Parent control and the delete-reassign target.
export function NodePickerSheet({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: NodePickerSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <FlatList
          data={options}
          keyExtractor={(o) => o.id ?? '__none__'}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedId;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => onSelect(item.id)}
                disabled={item.disabled}
              >
                <View style={styles.rowText}>
                  <Text
                    style={[
                      styles.label,
                      item.disabled && styles.labelDisabled,
                    ]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {item.sublabel ? (
                    <Text style={styles.sublabel} numberOfLines={1}>
                      {item.sublabel}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <Ionicons name="checkmark" size={18} color={colors.accent} />
                ) : null}
              </TouchableOpacity>
            );
          }}
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
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  rowText: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  labelDisabled: {
    color: colors.ink4,
  },
  sublabel: {
    fontSize: fontSize.sm,
    color: colors.ink3,
    marginTop: space.xxs,
  },
});
