import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontWeight, fontSize, radii, space } from '@amarnai/tokens';
import { useSession } from '../auth/session';
import { startCheckout } from '../billing/api';
import { setPendingCheckout } from '../billing/pendingCheckout';
import { BottomSheet } from './BottomSheet';
import { FormInput } from './FormInput';
import { toUserMessage } from '../errors';

type PlanId = 'free' | 'pro' | 'business';
type BillingCycle = 'monthly' | 'annual';

const ALL_PLANS = [
  {
    id: 'free' as PlanId,
    name: 'Personal',
    tagline: 'For individuals trying Amarnai on their own inbox.',
    price: (_cycle: BillingCycle) => 'Free',
  },
  {
    id: 'pro' as PlanId,
    name: 'Pro',
    tagline: 'For power users and small businesses.',
    price: (cycle: BillingCycle) => (cycle === 'annual' ? '$4/mo' : '$5/mo'),
    badge: 'Most popular',
  },
  {
    id: 'business' as PlanId,
    name: 'Business',
    tagline: 'For larger organizations.',
    price: (cycle: BillingCycle) => (cycle === 'annual' ? '$10/mo' : '$12/mo'),
  },
];

interface NewWorkspaceSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function NewWorkspaceSheet({ visible, onClose }: NewWorkspaceSheetProps) {
  const { userId, workspaces, client, refreshWorkspaces } = useSession();
  const { bottom } = useSafeAreaInsets();

  // Refresh workspaces on open so `plan` is always fresh (it was added to the
  // API response and may not be in a session bootstrapped against an older build).
  useEffect(() => {
    if (visible) void refreshWorkspaces();
  }, [visible, refreshWorkspaces]);

  // Filter out the free plan when the user already owns one — mirrors the web's
  // `availablePlans = PLANS.filter((p) => !hasFreeWorkspace || p.id !== "free")`.
  const hasFreeWorkspace = workspaces.some((w) => w.owner.id === userId && w.plan === 'FREE');
  const availablePlans = ALL_PLANS.filter((p) => !hasFreeWorkspace || p.id !== 'free');

  const defaultPlan: PlanId = hasFreeWorkspace ? 'pro' : 'free';
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(defaultPlan);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-apply the default plan whenever the available set changes (e.g. after
  // the refresh above updates hasFreeWorkspace).
  useEffect(() => {
    setSelectedPlan(defaultPlan);
  }, [defaultPlan]);

  const handleClose = () => {
    setName('');
    setError(null);
    setLoading(false);
    onClose();
  };

  const canSubmit = name.trim().length > 0 && !loading;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    if (selectedPlan === 'free') {
      try {
        const created = await client.createWorkspace(trimmed);
        await refreshWorkspaces(created.id);
        setName('');
        onClose();
      } catch (err) {
        setError(toUserMessage(err, 'Could not create workspace. Please try again.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Paid plan: create a Stripe checkout session via the web's billing endpoint.
    try {
      const res = await startCheckout({
        action: 'create',
        plan: selectedPlan,
        cycle,
        newWorkspaceName: trimmed,
      });

      if (!res.ok || !res.data.url) {
        setError(res.data.error ?? `Could not start checkout (${res.status}). Please try again.`);
        setLoading(false);
        return;
      }
      // Record the session so we confirm provisioning on return from the browser
      // (webhook-independent); the new workspace then appears after refresh.
      if (res.data.sessionId) await setPendingCheckout(res.data.sessionId);
      // Open Stripe checkout in the device browser.
      await Linking.openURL(res.data.url);
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? `Checkout failed: ${err.message}` : 'Could not start checkout. Please try again.',
      );
      setLoading(false);
    }
  };

  const ctaLabel = loading
    ? selectedPlan === 'free'
      ? 'Creating…'
      : 'Redirecting…'
    : selectedPlan === 'free'
      ? 'Create workspace'
      : 'Continue to checkout';

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
          <Text style={styles.title}>New workspace</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Plan cards — mirrors CreateWorkspaceDialog's availablePlans filter */}
            <View style={styles.planCards}>
              {availablePlans.map((plan) => {
                const isSelected = selectedPlan === plan.id;
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={[styles.planCard, isSelected && styles.planCardSelected]}
                    onPress={() => setSelectedPlan(plan.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.planCardRadio}>
                      {isSelected && <View style={styles.planCardRadioDot} />}
                    </View>
                    <View style={styles.planCardText}>
                      <View style={styles.planCardNameRow}>
                        <Text style={styles.planCardName}>{plan.name}</Text>
                        {'badge' in plan && plan.badge ? (
                          <View style={styles.planBadge}>
                            <Text style={styles.planBadgeText}>{plan.badge}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.planCardPrice}>{plan.price(cycle)}</Text>
                      <Text style={styles.planCardTagline} numberOfLines={2}>
                        {plan.tagline}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Name input */}
            <FormInput
              value={name}
              onChangeText={setName}
              placeholder="Workspace name"
              maxLength={100}
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={() => void handleSubmit()}
            />

            {/* Billing cycle toggle — only for paid plans, mirrors "plans-seg" */}
            {selectedPlan !== 'free' && (
              <View style={styles.cycleToggle}>
                <TouchableOpacity
                  style={[styles.cycleBtn, cycle === 'monthly' && styles.cycleBtnActive]}
                  onPress={() => setCycle('monthly')}
                >
                  <Text
                    style={[styles.cycleBtnText, cycle === 'monthly' && styles.cycleBtnTextActive]}
                  >
                    Monthly
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cycleBtn, cycle === 'annual' && styles.cycleBtnActive]}
                  onPress={() => setCycle('annual')}
                >
                  <Text
                    style={[styles.cycleBtnText, cycle === 'annual' && styles.cycleBtnTextActive]}
                  >
                    Annual · Save 20%
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { paddingBottom: space.lg + bottom }]}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} disabled={loading}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.btnDisabled]}
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {loading ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <>
                  <Text style={styles.submitBtnText}>{ctaLabel}</Text>
                  {selectedPlan !== 'free' && (
                    <Ionicons name="open-outline" size={14} color={colors.surface} />
                  )}
                </>
              )}
            </TouchableOpacity>
          </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: space.md,
    // Shrink within the sheet's height cap (set in BottomSheet) so the body
    // scrolls while the footer stays pinned; clip rounded corners.
    flexShrink: 1,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.line3,
    marginBottom: space.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    gap: space.lg,
  },
  planCards: {
    gap: space.md,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    padding: space.lg,
    backgroundColor: colors.surface,
  },
  planCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.bg,
  },
  planCardRadio: {
    width: 18,
    height: 18,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.line3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  planCardRadioDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  planCardText: {
    flex: 1,
    gap: space.xxs,
  },
  planCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  planCardName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  planBadge: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  planBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
  planCardPrice: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  planCardTagline: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  cycleToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  cycleBtn: {
    flex: 1,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  cycleBtnActive: {
    backgroundColor: colors.accent,
  },
  cycleBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink3,
  },
  cycleBtnTextActive: {
    color: colors.surface,
    fontWeight: fontWeight.semibold,
  },
  errorText: {
    fontSize: fontSize.md,
    color: colors.danger,
  },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: fontSize.lg,
    color: colors.ink3,
  },
  submitBtn: {
    flex: 2,
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
