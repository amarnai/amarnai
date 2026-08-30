import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, fontSize, fontWeight, space } from '@aziru/tokens';

interface Props {
  children: ReactNode;
  danger?: boolean;
}

export function SectionTitle({ children, danger }: Props) {
  return (
    <Text style={[styles.title, danger && styles.danger]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    textTransform: 'uppercase',
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    paddingBottom: space.md,
  },
  danger: {
    color: colors.danger,
  },
});
