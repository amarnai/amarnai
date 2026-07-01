import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';

interface RoutingIndicatorProps {
  count: number;
  min: number;
  // When provided (editors only), a full-width "Generate from inbox" button is
  // shown below the message so the fastest path to a routable taxonomy is
  // obvious. Omitted for read-only viewers.
  onGenerate?: () => void;
}

// Mirror of the web "X / 3 folders connected" warning. Rendered only when the
// taxonomy is not yet routable, so the count is always below `min` here.
export function RoutingIndicator({ count, min, onGenerate }: RoutingIndicatorProps) {
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>
            {count} / {min}
          </Text>
        </View>
        <Text style={styles.message}>
          {count} of {min} folders connected to your inbox. Routing needs at least {min}.
        </Text>
      </View>
      {onGenerate ? (
        <TouchableOpacity style={styles.generateBtn} onPress={onGenerate}>
          <Ionicons name="color-wand-outline" size={16} color={colors.surface} />
          <Text style={styles.generateBtnText}>
            <Trans>Generate from inbox</Trans>
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
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
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.md,
  },
  generateBtnText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
