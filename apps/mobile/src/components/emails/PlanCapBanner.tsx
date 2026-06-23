import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { SyncStatus } from '@amarnai/api-client';

interface PlanCapBannerProps {
  syncStatus: SyncStatus | null | undefined;
  dismissed?: boolean;
  onDismiss?: () => void;
}

/**
 * Shown when the historical backfill stopped at the plan's thread cap with more
 * threads still in Gmail. Mirrors the web PlanCapBanner: surfaces the approximate
 * beyond-cap count and routes to the in-app upgrade flow (a higher plan re-runs
 * the backfill up to the larger cap). Dismissible for the session.
 */
export function PlanCapBanner({ syncStatus, dismissed, onDismiss }: PlanCapBannerProps) {
  const router = useRouter();

  if (!syncStatus || !syncStatus.backfillCapReached || dismissed) return null;

  const count = syncStatus.backfillBeyondCount;
  const countLabel =
    count > 0 ? `About ${count.toLocaleString()} more thread${count === 1 ? '' : 's'}` : 'More threads';

  return (
    <View style={[styles.card, styles.cardLocked]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, styles.titleFlex]}>
          {countLabel} beyond your {syncStatus.workspacePlan} plan limit aren&apos;t loaded.
        </Text>
        {onDismiss ? (
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Dismiss"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={18} color={colors.ink4} />
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity style={styles.btn} onPress={() => router.push('/(app)/plan')}>
        <Text style={styles.btnText}>Upgrade to load them</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.xl,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
  },
  cardLocked: {
    borderStyle: 'dashed',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  title: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  titleFlex: {
    flex: 1,
  },
  btn: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  btnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
});
