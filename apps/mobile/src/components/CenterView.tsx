import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { space } from '@amarnai/tokens';

interface Props {
  children: ReactNode;
  style?: ViewStyle;
}

export function CenterView({ children, style }: Props) {
  return <View style={[styles.center, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
});
