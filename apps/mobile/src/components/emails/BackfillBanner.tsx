import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { SyncStatus } from '@amarnai/api-client';

interface BackfillBannerProps {
  syncStatus: SyncStatus | null | undefined;
  // When the FREE-plan upsell is dismissed, the screen hides it for the session.
  dismissed?: boolean;
  onDismiss?: () => void;
}

/**
 * Mobile equivalent of the web's BackfillCard (packages/ui/src/emails/BackfillCard.tsx).
 * FREE plans see an upgrade upsell; paid plans see a live "sorting in progress"
 * card while a historical backfill runs. All other states render nothing.
 * Billing is web-only, so the upsell points users to the web app rather than
 * linking to an in-app upgrade flow. The upsell is closable (session-scoped);
 * the "sorting in progress" card is transient state and is not dismissible.
 */
export function BackfillBanner({ syncStatus, dismissed, onDismiss }: BackfillBannerProps) {
  if (!syncStatus) return null;

  if (syncStatus.workspacePlan === 'FREE') {
    if (dismissed) return null;
    return (
      <View style={[styles.card, styles.cardLocked]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, styles.titleFlex]}>Bulk triage your inbox</Text>
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
        <Text style={styles.desc}>
          Sort thousands of historical emails automatically. Available on Pro and Business
          plans.
        </Text>
        <Text style={styles.note}>Upgrade your plan on the web app to enable backfill.</Text>
      </View>
    );
  }

  if (syncStatus.backfillStatus !== 'RUNNING') return null;

  return (
    <View style={styles.card}>
      <View style={styles.eyebrowRow}>
        <PulseDot />
        <Text style={styles.eyebrow}>Sorting historical inbox</Text>
      </View>
      <Text style={styles.title}>Sorting in progress…</Text>
      <Text style={styles.desc}>New threads will appear as they are sorted.</Text>
    </View>
  );
}

function PulseDot() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.pulse, { opacity }]} />;
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
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.accentInk,
  },
  pulse: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  title: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    marginTop: space.xs,
  },
  titleFlex: {
    flex: 1,
  },
  desc: {
    fontSize: fontSize.sm,
    color: colors.ink3,
    marginTop: space.xxs,
    lineHeight: 18,
  },
  note: {
    fontSize: fontSize.sm,
    color: colors.accentInk,
    marginTop: space.sm,
  },
});
