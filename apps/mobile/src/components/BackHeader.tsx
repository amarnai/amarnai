import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, fontWeight, space } from '@amarnai/tokens';

interface Props {
  title: string;
  onBack: () => void;
}

export function BackHeader({ title, onBack }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
      <TouchableOpacity style={styles.back} onPress={onBack} hitSlop={8}>
        <Ionicons name="chevron-back" size={24} color={colors.ink} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    gap: space.lg,
  },
  back: {
    paddingVertical: space.xxs,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    flex: 1,
  },
});
