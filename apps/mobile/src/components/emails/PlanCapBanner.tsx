import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg, plural } from '@lingui/core/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { TOP_PLAN, getDraftQuotaResetsAt, formatQuotaResetDate } from '@amarnai/shared';
import type { SyncStatus } from '@amarnai/api-client';

interface PlanCapBannerProps {
  syncStatus: SyncStatus | null | undefined;
  dismissed?: boolean;
  onDismiss?: () => void;
}

/**
 * Shown when the historical backfill stopped at the plan's thread cap with more
 * threads still in Gmail. Mirrors the web PlanCapBanner: surfaces the approximate
 * beyond-cap count. Below the top tier it routes to the in-app upgrade flow (a
 * higher plan re-runs the backfill up to the larger cap); at the top tier there is
 * no higher plan, so it tells the user when the pooled monthly budget refreshes
 * instead. Dismissible for the session.
 */
export function PlanCapBanner({ syncStatus, dismissed, onDismiss }: PlanCapBannerProps) {
  const router = useRouter();
  const { i18n } = useLingui();

  if (!syncStatus || !syncStatus.backfillCapReached || dismissed) return null;

  const count = syncStatus.backfillBeyondCount;
  const plan = syncStatus.workspacePlan;
  const isTopPlan = plan === TOP_PLAN;
  const refreshDate = formatQuotaResetDate(getDraftQuotaResetsAt().toISOString());
  const title =
    count > 0
      ? i18n._(
          msg`About ${plural(count, {
            one: '# more thread',
            other: '# more threads',
          })} beyond your ${plan} subscription limit aren't loaded.`,
        )
      : i18n._(msg`More threads beyond your ${plan} subscription limit aren't loaded.`);

  return (
    <View style={[styles.card, styles.cardLocked]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, styles.titleFlex]}>{title}</Text>
        {onDismiss ? (
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={i18n._(msg`Dismiss`)}
            accessibilityRole="button"
          >
            <Ionicons name="close" size={18} color={colors.ink4} />
          </TouchableOpacity>
        ) : null}
      </View>
      {isTopPlan ? (
        <Text style={styles.refreshNote}>
          {i18n._(msg`Refresh after ${refreshDate} to load more.`)}
        </Text>
      ) : (
        <TouchableOpacity style={styles.btn} onPress={() => router.push('/(app)/subscription')}>
          <Text style={styles.btnText}>
            <Trans>Upgrade to load the rest</Trans>
          </Text>
        </TouchableOpacity>
      )}
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
  refreshNote: {
    marginTop: space.sm,
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
});
