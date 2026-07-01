import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import { TOP_PLAN, getDraftQuotaResetsAt, formatQuotaResetDate } from '@amarnai/shared';
import type { SyncStatus } from '@amarnai/api-client';

interface PlanCapBannerProps {
  syncStatus: SyncStatus | null | undefined;
  dismissed?: boolean;
  onDismiss?: () => void;
}

/**
 * Shown when the historical backfill couldn't load everything, with a message that
 * adapts to WHY (backfillLimitState): initial import hit the plan cap (CAPPED), the
 * one monthly grace re-import hit it too (CAPPED_RETRY), or the whole monthly
 * allowance is spent until the window rolls (BLOCKED). Mirrors the web banner. Below
 * the top tier it routes to the in-app upgrade flow; at the top tier the only lever
 * is the monthly refresh. Dismissible for the session.
 */
export function PlanCapBanner({ syncStatus, dismissed, onDismiss }: PlanCapBannerProps) {
  const router = useRouter();
  const { i18n } = useLingui();

  const state = syncStatus?.backfillLimitState;
  if (!syncStatus || !state || state === 'NONE' || dismissed) return null;

  const plan = syncStatus.workspacePlan;
  const isTopPlan = plan === TOP_PLAN;
  const refreshDate = formatQuotaResetDate(getDraftQuotaResetsAt().toISOString());
  const title =
    state === 'BLOCKED'
      ? i18n._(msg`You've used all of your ${plan} plan's email imports this month, including one retry. Imports refresh ${refreshDate}.`)
      : state === 'CAPPED_RETRY'
        ? i18n._(msg`Your retry import finished and is still capped by your ${plan} plan. Your next retry is available ${refreshDate}.`)
        : i18n._(msg`Your ${plan} plan finished importing your most recent emails. Older ones beyond its limit weren't loaded.`);

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
      {!isTopPlan ? (
        <TouchableOpacity style={styles.btn} onPress={() => router.push('/(app)/subscription')}>
          <Text style={styles.btnText}>
            {state === 'BLOCKED' ? <Trans>Upgrade to import now</Trans> : <Trans>Upgrade to load the rest</Trans>}
          </Text>
        </TouchableOpacity>
      ) : null}
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
