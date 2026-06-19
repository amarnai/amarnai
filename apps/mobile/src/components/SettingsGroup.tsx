import type { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { colors, space } from '@amarnai/tokens';

interface GroupProps {
  children: ReactNode;
  style?: ViewStyle;
}

export function SettingsGroup({ children, style }: GroupProps) {
  return <View style={[styles.group, style]}>{children}</View>;
}

interface RowProps {
  children: ReactNode;
  onPress?: () => void;
  divider?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function SettingsRow({ children, onPress, divider, disabled, style }: RowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, divider && styles.divider, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  group: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  disabled: {
    opacity: 0.5,
  },
});
