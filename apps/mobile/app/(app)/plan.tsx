import { useCallback, useRef, useState } from 'react';
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
import type { BillingState, PlanId, BillingCycle } from '@amarnai/shared';
import type { QuotaInfo } from '@amarnai/api-client';
import { colors, fontSize, fontWeight, radii, space } from '@amarnai/tokens';
import { useSession } from '../../src/auth/session';
import {
  cancelSubscription,
  changePlan,
  createPortalSession,
  getBillingState,
  startCheckout,
} from '../../src/billing/api';
import { selectPlanAction } from '../../src/billing/selectPlanAction';
import { BackHeader } from '../../src/components/BackHeader';
import { ScreenContainer } from '../../src/components/ScreenContainer';
import { CenterView } from '../../src/components/CenterView';
import { SectionTitle } from '../../src/components/SectionTitle';
import { SettingsGroup, SettingsRow } from '../../src/components/SettingsGroup';
import { UsageRow } from '../../src/components/billing/UsageRow';
import { PricingSheet } from '../../src/components/billing/PricingSheet';

const PLAN_LABEL: Record<string, string> = { FREE: 'Free', PRO: 'Pro', BUSINESS: 'Business' };
const CYCLE_LABEL: Record<string, string> = { MONTHLY: 'Monthly', ANNUAL: 'Annual' };

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });

type BannerKind = 'info' | 'warn' | 'error';

export default function PlanScreen() {
  const router = useRouter();
  const { workspaceId, client, refreshWorkspaces } = useSession();

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
      setLoadError(errorMessage(err, 'Could not load billing'));
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

  // Keep the session's plan label in sync after an in-app change.
  const refreshSession = useRef(refreshWorkspaces);
  refreshSession.current = refreshWorkspaces;

  const afterChange = useCallback(async () => {
    await Promise.all([reload(), refreshSession.current()]);
  }, [reload]);

  function confirmCancel() {
    if (!workspaceId) return;
    Alert.alert(
      'Cancel subscription?',
      state?.trialEndsAt && new Date(state.trialEndsAt) > new Date()
        ? 'Your trial ends immediately and the workspace downgrades to Free.'
        : 'Your plan stays active until the end of the current billing period, then downgrades to Free.',
      [
        { text: 'Keep plan', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const res = await cancelSubscription(workspaceId);
                if (!res.ok) {
                  Alert.alert('Could not cancel', res.data.error ?? 'Please try again.');
                  return;
                }
                await afterChange();
              } catch (err) {
                Alert.alert('Could not cancel', errorMessage(err, 'Please try again.'));
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
        Alert.alert('Unavailable', res.data.error ?? 'Could not open billing management.');
        return;
      }
      await Linking.openURL(res.data.url);
    } catch (err) {
      Alert.alert('Unavailable', errorMessage(err, 'Could not open billing management.'));
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
          Alert.alert('Could not upgrade', res.data.error ?? 'Please try again.');
          return;
        }
        setPricingOpen(false);
        if (res.data.url) {
          // New paid subscription needs payment — hand off to the browser.
          await Linking.openURL(res.data.url);
        } else {
          // Paid -> paid upgrade applied directly (proration), no browser.
          await afterChange();
        }
      } else {
        // In-app downgrade / cycle change.
        const res = await changePlan({ workspaceId, plan: action.plan, cycle: action.cycle });
        if (!res.ok) {
          Alert.alert('Could not change plan', res.data.error ?? 'Please try again.');
          return;
        }
        setPricingOpen(false);
        await afterChange();
      }
    } catch (err) {
      Alert.alert('Something went wrong', errorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ScreenContainer>
        <BackHeader title="Plan & billing" onBack={() => router.back()} />
        <CenterView>
          <ActivityIndicator color={colors.accent} />
        </CenterView>
      </ScreenContainer>
    );
  }

  if (loadError || !state) {
    return (
      <ScreenContainer>
        <BackHeader title="Plan & billing" onBack={() => router.back()} />
        <CenterView>
          <Text style={styles.muted}>{loadError ?? 'Could not load billing.'}</Text>
        </CenterView>
      </ScreenContainer>
    );
  }

  const isTrialing = state.trialEndsAt !== null && new Date(state.trialEndsAt) > new Date();
  const banners: { kind: BannerKind; text: string }[] = [];
  if (state.paymentFailed) {
    banners.push({ kind: 'error', text: 'Payment failed. Update your payment method to keep access.' });
  }
  if (state.cancelAtPeriodEnd && state.currentPeriodEnd) {
    banners.push({
      kind: 'warn',
      text: `Subscription will not renew. Access ends ${formatDate(state.currentPeriodEnd)}.`,
    });
  } else if (isTrialing && state.trialEndsAt) {
    banners.push({ kind: 'info', text: `Free trial until ${formatDate(state.trialEndsAt)}.` });
  } else if (state.currentPeriodEnd && state.plan !== 'FREE') {
    banners.push({ kind: 'info', text: `Renews ${formatDate(state.currentPeriodEnd)}.` });
  }

  const planLabel = PLAN_LABEL[state.plan] ?? state.plan;
  const cycleLabel = state.billingCycle ? CYCLE_LABEL[state.billingCycle] : null;
  const canManage = state.isOwner;
  const showCancel = canManage && state.hasSubscription && !state.cancelAtPeriodEnd;

  return (
    <ScreenContainer>
      <BackHeader title="Plan & billing" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        {banners.map((b) => (
          <View key={b.text} style={[styles.banner, styles[`banner_${b.kind}`]]}>
            <Text style={[styles.bannerText, styles[`bannerText_${b.kind}`]]}>{b.text}</Text>
          </View>
        ))}

        <View style={styles.planRow}>
          <Text style={styles.planRowLabel}>Current plan</Text>
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>
              {planLabel}
              {cycleLabel ? ` · ${cycleLabel}` : ''}
            </Text>
          </View>
        </View>

        <SectionTitle>This month</SectionTitle>
        <View style={styles.usage}>
          <UsageRow label="AI drafts" quota={draftQuota} />
          <UsageRow label="Threads sorted" quota={threadSortQuota} />
        </View>

        {canManage ? (
          <>
            <SectionTitle>Manage</SectionTitle>
            <SettingsGroup>
              <SettingsRow onPress={() => setPricingOpen(true)} disabled={busy}>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.ink3} />
                <Text style={styles.rowLabel}>Change plan</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink4} />
              </SettingsRow>
              {state.hasSubscription ? (
                <SettingsRow divider onPress={() => void handleManagePayment()} disabled={busy}>
                  <Ionicons name="card-outline" size={20} color={colors.ink3} />
                  <Text style={styles.rowLabel}>Manage payment method</Text>
                  <Ionicons name="open-outline" size={16} color={colors.ink4} />
                </SettingsRow>
              ) : null}
            </SettingsGroup>

            {showCancel ? (
              <>
                <SectionTitle danger>Danger zone</SectionTitle>
                <SettingsGroup>
                  <SettingsRow onPress={confirmCancel} disabled={busy}>
                    <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
                    <Text style={[styles.rowLabel, styles.rowLabelGrow, styles.dangerLabel]}>
                      Cancel subscription
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.danger} />
                  </SettingsRow>
                </SettingsGroup>
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.muted}>Only the workspace owner can manage billing.</Text>
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
