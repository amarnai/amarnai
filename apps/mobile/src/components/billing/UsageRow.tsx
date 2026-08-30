import { StyleSheet, Text, View } from 'react-native';
import type { QuotaInfo } from '@aziru/api-client';
import { colors, fontSize, radii, space } from '@aziru/tokens';

export function UsageRow({ label, quota }: { label: string; quota: QuotaInfo | null }) {
  if (!quota) {
    return (
      <View style={styles.usageRow}>
        <Text style={styles.usageLabel}>{label}</Text>
        <Text style={styles.usageValue}>—</Text>
      </View>
    );
  }
  const pct = quota.limit > 0 ? Math.min(1, quota.used / quota.limit) : 0;
  return (
    <View style={styles.usageBlock}>
      <View style={styles.usageRow}>
        <Text style={styles.usageLabel}>{label}</Text>
        <Text style={styles.usageValue}>
          {quota.used} / {quota.limit}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  usageBlock: {
    gap: space.xs,
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  usageLabel: {
    fontSize: fontSize.md,
    color: colors.ink,
  },
  usageValue: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  barTrack: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.bgSunk,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
});
