import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PLANS, type PlanId, type BillingCycle, type BillingPlan, type BillingCycleValue } from '@amarnai/shared';
import { colors, fontSize, fontWeight, radii, space } from '@amarnai/tokens';
import { SheetLayout } from '../SheetLayout';
import { PLAN_TO_BILLING } from '../../billing/selectPlanAction';

interface Props {
  visible: boolean;
  onClose: () => void;
  currentPlan: BillingPlan;
  currentCycle: BillingCycleValue | null;
  busy: boolean;
  onSelect: (plan: PlanId, cycle: BillingCycle) => void;
}

export function PricingSheet({ visible, onClose, currentPlan, currentCycle, busy, onSelect }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>(
    currentCycle === 'ANNUAL' ? 'annual' : 'monthly',
  );
  const cycleValue: BillingCycleValue = cycle === 'annual' ? 'ANNUAL' : 'MONTHLY';

  return (
    <SheetLayout visible={visible} onClose={onClose} title="Change subscription">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.cycleToggle}>
          <TouchableOpacity
            style={[styles.cycleBtn, cycle === 'monthly' && styles.cycleBtnActive]}
            onPress={() => setCycle('monthly')}
          >
            <Text style={[styles.cycleBtnText, cycle === 'monthly' && styles.cycleBtnTextActive]}>
              Monthly
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cycleBtn, cycle === 'annual' && styles.cycleBtnActive]}
            onPress={() => setCycle('annual')}
          >
            <Text style={[styles.cycleBtnText, cycle === 'annual' && styles.cycleBtnTextActive]}>
              Annual · Save 20%
            </Text>
          </TouchableOpacity>
        </View>

        {PLANS.map((plan) => {
          const planBilling = PLAN_TO_BILLING[plan.id];
          const isCurrent =
            planBilling === currentPlan &&
            (plan.free || currentCycle === null || currentCycle === cycleValue);
          const price = plan.free
            ? 'Free'
            : `$${cycle === 'annual' ? plan.annualMonthlyPrice : plan.monthlyPrice}/mo`;

          return (
            <View key={plan.id} style={[styles.card, plan.featured && styles.cardFeatured]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{plan.name}</Text>
                {plan.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{plan.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardPrice}>{price}</Text>

              <View style={styles.highlights}>
                {plan.highlights.map((h) => (
                  <View key={h} style={styles.highlightRow}>
                    <Ionicons name="checkmark" size={14} color={colors.accent} />
                    <Text style={styles.highlightText}>{h}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.cta, (isCurrent || busy) && styles.ctaDisabled]}
                disabled={isCurrent || busy}
                onPress={() => onSelect(plan.id, cycle)}
              >
                <Text style={styles.ctaText}>{isCurrent ? 'Current subscription' : `Switch to ${plan.name}`}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexShrink: 1,
  },
  content: {
    padding: space.xl,
    gap: space.lg,
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
  card: {
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    gap: space.sm,
  },
  cardFeatured: {
    borderColor: colors.accent,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  cardName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
  cardPrice: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  highlights: {
    gap: space.xs,
    marginVertical: space.xs,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  highlightText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.xs,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
});
