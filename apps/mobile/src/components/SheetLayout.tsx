import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, fontWeight, radii, space } from '@amarnai/tokens';
import { BottomSheet } from './BottomSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  keyboardAvoiding?: boolean;
  handle?: boolean;
}

export function SheetLayout({
  visible,
  onClose,
  title,
  children,
  keyboardAvoiding,
  handle = false,
}: Props) {
  const { bottom } = useSafeAreaInsets();
  return (
    <BottomSheet visible={visible} onClose={onClose} {...(keyboardAvoiding ? { keyboardAvoiding } : {})}>
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        {handle ? (
          <View style={styles.handleHeader}>
            <View style={styles.handlePill} />
            <Text style={styles.handleTitle}>{title}</Text>
          </View>
        ) : (
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.ink3} />
            </TouchableOpacity>
          </View>
        )}
        {children}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    // Shrink within the sheet's height cap (set in BottomSheet) so a scroll view
    // child scrolls; clip rounded corners against scrolled content.
    flexShrink: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  handleHeader: {
    paddingTop: space.md,
    alignItems: 'flex-start',
  },
  handlePill: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.line3,
    marginBottom: space.md,
  },
  handleTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
});
