import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';

interface RoutingIndicatorProps {
  count: number;
  min: number;
}

// Mirror of the web "X / 3 categories connected" warning. Rendered only when the
// taxonomy is not yet routable, so the count is always below `min` here.
export function RoutingIndicator({ count, min }: RoutingIndicatorProps) {
  return (
    <View style={styles.box}>
      <View style={styles.pill}>
        <Text style={styles.pillText}>
          {count} / {min}
        </Text>
      </View>
      <Text style={styles.message}>
        {count} of {min} folders connected to your inbox. Routing needs at least {min}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warnLine,
    borderRadius: radii.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginHorizontal: space.xl,
    marginBottom: space.md,
  },
  pill: {
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
  },
  pillText: {
    color: colors.surface,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  message: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.warnInk,
  },
});
