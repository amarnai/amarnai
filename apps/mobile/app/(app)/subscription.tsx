import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { MessageDescriptor } from '@lingui/core';
import type { BillingState, PlanId, BillingCycle } from '@aziru/shared';
import type { QuotaInfo } from '@aziru/api-client';
import { colors, fontSize, fontWeight, radii, space } from '@aziru/tokens';
import { useSession } from '../../src/auth/session';
import {
  cancelSubscription,
  changePlan,
  createPortalSession,
  getBillingState,
  startCheckout,
} from '../../src/billing/api';
import { selectPlanAction } from '../../src/billing/selectPlanAction';
import { setPendingCheckout } from '../../src/billing/pendingCheckout';
import { BackHeader } from '../../src/components/BackHeader';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { CenterView } from '../../src/components/CenterView';
import { SectionTitle } from '../../src/components/SectionTitle';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsGroup';
import { UsageRow } from '../../src/components/billing/UsageRow';
import { PricingSheet } from '../../src/components/billing/PricingSheet';
import { toUserMessage } from '../../src/errors';

const PLAN_LABEL: Record<string, MessageDescriptor> = { FREE: msg`Free`, PRO: msg`Pro`, BUSINESS: msg`Business` };
const CYCLE_LABEL: Record<string, MessageDescriptor> = { MONTHLY: msg`Monthly`, ANNUAL: msg`Annual` };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });

type BannerKind = 'info' | 'warn' | 'error';

export default function PlanScreen() {
  const router = useRouter();
  const { i18n } = useLingui();
  const { workspaceId, client, refreshWorkspaces, workspaces } = useSession();
  // The session's plan for the active workspace updates when a checkout is
  // confirmed on foreground (SessionProvider); re-fetch billing state when it does.
  const sessionPlan = workspaces.find((w) => w.id === workspaceId)?.plan;

  const [state, setState] = useState<BillingState | null>(null);
  const [draftQuota, setDraftQuota] = useState<QuotaInfo | null>(null);
  const [threadSortQuota, setThreadSortQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [billing] = await Promise.all([
        getBillingState(workspaceId),
        Promise.allSettled([client.draftQuota(workspaceId), client.threadSortQuota(workspaceId)]).then(
          ([d, t]) => {
            setDraftQuota(d.status === 'fulfilled' ? d.value : null);
            setThreadSortQuota(t.status === 'fulfilled' ? t.value : null);
          },
        ),
      ]);
      setState(billing);
      setLoadError(null);
    } catch (err) {
      setLoadError(toUserMessage(err, i18n._(msg`Could not load billing`)));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, client]);

  // Refresh on focus, and when returning to the foreground (e.g. back from the
  // Stripe checkout/portal browser tab), mirroring the verify-email pattern.
  useFocusEffect(
    useCallback(() => {
      void reload();
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') void reload();
      });
      return () => sub.remove();
    }, [reload]),
  );

  // Re-fetch billing state when the session plan changes (e.g. a checkout was
  // confirmed on foreground), so the screen reflects the new plan without a manual refresh.
  useEffect(() => {
    void reload();
  }, [sessionPlan, reload]);

  // Keep the session's plan label in sync after an in-app change.
  const refreshSession = useRef(refreshWorkspaces);
  refreshSession.current = refreshWorkspaces;

  const afterChange = useCallback(async () => {
    await Promise.all([reload(), refreshSession.current()]);
  }, [reload]);

  function confirmCancel() {
    if (!workspaceId) return;
    Alert.alert(
      i18n._(msg`Cancel subscription?`),
      state?.trialEndsAt && new Date(state.trialEndsAt) > new Date()
        ? i18n._(msg`Your trial ends immediately and the workspace downgrades to Free.`)
        : i18n._(msg`Your subscription stays active until the end of the current billing period, then downgrades to Free.`),
      [
        { text: i18n._(msg`Keep subscription`), style: 'cancel' },
        {
          text: i18n._(msg`Cancel subscription`),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const res = await cancelSubscription(workspaceId);
                if (!res.ok) {
                  Alert.alert(i18n._(msg`Could not cancel`), res.data.error ?? i18n._(msg`Please try again.`));
                  return;
                }
                await afterChange();
              } catch (err) {
                Alert.alert(i18n._(msg`Could not cancel`), toUserMessage(err, i18n._(msg`Please try again.`)));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  async function handleManagePayment() {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const res = await createPortalSession(workspaceId);
      if (!res.ok || !res.data.url) {
        Alert.alert(i18n._(msg`Unavailable`), res.data.error ?? i18n._(msg`Could not open billing management.`));
        return;
      }
      await Linking.openURL(res.data.url);
    } catch (err) {
      Alert.alert(i18n._(msg`Unavailable`), toUserMessage(err, i18n._(msg`Could not open billing management.`)));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectPlan(plan: PlanId, cycle: BillingCycle) {
    if (!workspaceId || !state) return;
    const action = selectPlanAction(
      { plan: state.plan, cycle: state.billingCycle },
      { plan, cycle },
    );

    if (action.kind === 'noop') {
      setPricingOpen(false);
      return;
    }
    if (action.kind === 'cancel') {
      setPricingOpen(false);
      confirmCancel();
      return;
    }

    setBusy(true);
    try {
      if (action.kind === 'upgrade') {
        const res = await startCheckout({
          action: 'upgrade',
          plan: action.plan,
          cycle: action.cycle,
          workspaceId,
        });
        if (!res.ok) {
          Alert.alert(i18n._(msg`Could not upgrade`), res.data.error ?? i18n._(msg`Please try again.`));
          return;
        }
        setPricingOpen(false);
        if (res.data.url) {
          // New paid subscription needs payment — hand off to the browser. Record
          // the session so we can confirm provisioning on return (webhook-independent).
          if (res.data.sessionId) await setPendingCheckout(res.data.sessionId);
          await Linking.openURL(res.data.url);
        } else {
          // Paid -> paid upgrade applied directly (proration), no browser.
          await afterChange();
        }
      } else {
        // In-app downgrade / cycle change.
        const res = await changePlan({ workspaceId, plan: action.plan, cycle: action.cycle });
        if (!res.ok) {
          Alert.alert(i18n._(msg`Could not change subscription`), res.data.error ?? i18n._(msg`Please try again.`));
          return;
        }
        setPricingOpen(false);
        await afterChange();
      }
    } catch (err) {
      Alert.alert(i18n._(msg`Something went wrong`), toUserMessage(err, i18n._(msg`Please try again.`)));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ScreenContainer>
        <BackHeader title={i18n._(msg`Subscription`)} onBack={() => router.back()} />
        <CenterView>
          <ActivityIndicator color={colors.accent} />
        </CenterView>
      </ScreenContainer>
    );
  }

  if (loadError || !state) {
    return (
      <ScreenContainer>
        <BackHeader title={i18n._(msg`Subscription`)} onBack={() => router.back()} />
        <CenterView>
          <Text style={styles.muted}>{loadError ?? i18n._(msg`Could not load billing.`)}</Text>
        </CenterView>
      </ScreenContainer>
    );
  }

  const isTrialing = state.trialEndsAt !== null && new Date(state.trialEndsAt) > new Date();
  const banners: { kind: BannerKind; text: string }[] = [];
  if (state.paymentFailed) {
    banners.push({ kind: 'error', text: i18n._(msg`Payment failed. Update your payment method to keep access.`) });
  }
  if (state.cancelAtPeriodEnd && state.currentPeriodEnd) {
    banners.push({
      kind: 'warn',
      text: i18n._(msg`Subscription will not renew. Access ends ${formatDate(state.currentPeriodEnd)}.`),
    });
  } else if (isTrialing && state.trialEndsAt) {
    banners.push({ kind: 'info', text: i18n._(msg`Free trial until ${formatDate(state.trialEndsAt)}.`) });
  } else if (state.currentPeriodEnd && state.plan !== 'FREE') {
    banners.push({ kind: 'info', text: i18n._(msg`Renews ${formatDate(state.currentPeriodEnd)}.`) });
  }

  const planDescriptor = PLAN_LABEL[state.plan];
  const planLabel = planDescriptor ? i18n._(planDescriptor) : state.plan;
  const cycleDescriptor = state.billingCycle ? CYCLE_LABEL[state.billingCycle] : undefined;
  const cycleLabel = cycleDescriptor ? i18n._(cycleDescriptor) : null;
  const canManage = state.isOwner;
  const showCancel = canManage && state.hasSubscription && !state.cancelAtPeriodEnd;

  return (
    <ScreenContainer>
      <BackHeader title={i18n._(msg`Subscription`)} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        {banners.map((b) => (
          <View key={b.text} style={[styles.banner, styles[`banner_${b.kind}`]]}>
            <Text style={[styles.bannerText, styles[`bannerText_${b.kind}`]]}>{b.text}</Text>
          </View>
        ))}

        <View style={styles.planRow}>
          <Text style={styles.planRowLabel}><Trans>Current subscription</Trans></Text>
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>
              {planLabel}
              {cycleLabel ? ` · ${cycleLabel}` : ''}
            </Text>
          </View>
        </View>

        <SectionTitle><Trans>This month</Trans></SectionTitle>
        <View style={styles.usage}>
          <UsageRow label={i18n._(msg`AI drafts`)} quota={draftQuota} />
          <UsageRow label={i18n._(msg`Threads sorted`)} quota={threadSortQuota} />
        </View>

        {canManage ? (
          <>
            <SectionTitle><Trans>Manage</Trans></SectionTitle>
            <SettingsGroup>
              <SettingsRow onPress={() => setPricingOpen(true)} disabled={busy}>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.ink3} />
                <Text style={styles.rowLabel}><Trans>Change subscription</Trans></Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>
              {state.hasSubscription ? (
                <SettingsRow divider onPress={() => void handleManagePayment()} disabled={busy}>
                  <Ionicons name="card-outline" size={20} color={colors.ink3} />
                  <Text style={styles.rowLabel}><Trans>Manage payment method</Trans></Text>
                  <Ionicons name="open-outline" size={16} color={colors.ink4} />
                </SettingsRow>
              ) : null}
            </SettingsGroup>

            {showCancel ? (
              <>
                <SectionTitle danger><Trans>Danger zone</Trans></SectionTitle>
                <SettingsGroup>
                  <SettingsRow onPress={confirmCancel} disabled={busy}>
                    <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
                    <Text style={[styles.rowLabel, styles.rowLabelGrow, styles.dangerLabel]}>
                      <Trans>Cancel subscription</Trans>
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.danger} />
                  </SettingsRow>
                </SettingsGroup>
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.muted}><Trans>Only the workspace owner can manage billing.</Trans></Text>
        )}
      </ScrollView>

      <PricingSheet
        visible={pricingOpen}
        onClose={() => setPricingOpen(false)}
        currentPlan={state.plan}
        currentCycle={state.billingCycle}
        busy={busy}
        onSelect={(plan, cycle) => void handleSelectPlan(plan, cycle)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: space.xl,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  banner: {
    marginHorizontal: space.xl,
    padding: space.lg,
    borderRadius: radii.md,
  },
  banner_info: { backgroundColor: colors.bgSunk },
  banner_warn: { backgroundColor: colors.bgSunk },
  banner_error: { backgroundColor: colors.dangerSoft },
  bannerText: { fontSize: fontSize.sm },
  bannerText_info: { color: colors.ink3 },
  bannerText_warn: { color: colors.ink },
  bannerText_error: { color: colors.danger },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space.xl,
  },
  planRowLabel: {
    fontSize: fontSize.lg,
    color: colors.ink,
  },
  planBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
  },
  planBadgeText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accentInk,
  },
  usage: {
    marginHorizontal: space.xl,
    gap: space.lg,
  },
  rowLabel: {
    fontSize: fontSize.lg,
    color: colors.ink,
    flex: 1,
  },
  rowLabelGrow: {
    flex: 1,
  },
  dangerLabel: {
    color: colors.danger,
  },
  muted: {
    fontSize: fontSize.md,
    color: colors.ink3,
    marginHorizontal: space.xl,
  },
});
