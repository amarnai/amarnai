import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';

interface Props {
  // The label content; wrap in a Lingui <Trans> so callers stay localized.
  children: ReactNode;
  onPress: () => void;
  // Optional leading icon (e.g. "color-wand-outline").
  icon?: ComponentProps<typeof Ionicons>['name'];
}

/**
 * Full-width accent CTA used inside inbox banners (routing "Generate from inbox",
 * plan-cap "Upgrade to load the rest"). Shorter than PrimaryButton so it sits
 * comfortably within a compact banner card. Stretches to its container's width.
 */
export function BannerActionButton({ children, onPress, icon }: Props) {
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={16} color={colors.surface} /> : null}
      <Text style={styles.text}>{children}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.md,
  },
  text: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
