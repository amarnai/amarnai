import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { SyncStatus } from '@amarnai/api-client';

interface BackfillBannerProps {
  syncStatus: SyncStatus | null | undefined;
}

/**
 * Mobile equivalent of the web's BackfillCard (packages/ui/src/emails/BackfillCard.tsx).
 * Shows a live "sorting in progress" card, on every plan, while a historical
 * backfill runs (fetching past threads from Gmail happens regardless of plan or
 * taxonomy). The taxonomy only gates sorting, so it just adapts the subtext. All
 * other states render nothing. The card is transient state and not dismissible.
 */
export function BackfillBanner({ syncStatus }: BackfillBannerProps) {
  if (!syncStatus) return null;

  // Shows while ingestion runs, and also stays up once ingestion is done if
  // threads are still in flight on the async Batch API (BACKFILL_BATCH_MODE) —
  // those settle over hours, with batched-cadence copy.
  const scheduledThreads = syncStatus.backfillScheduledThreads ?? 0;
  const isRunning = syncStatus.backfillStatus === 'RUNNING';
  if (!isRunning && scheduledThreads === 0) return null;

  const awaitingTaxonomy = syncStatus.backfillAwaitingTaxonomy ?? false;
  const batched = scheduledThreads > 0;

  // No count or percentage: Gmail exposes no reliable total, and a per-thread count
  // would sit at zero during the initial page fetch. An indeterminate bar is honest
  // and never misleads — it just signals activity.
  return (
    <View style={styles.card}>
      <View style={styles.eyebrowRow}>
        <PulseDot />
        <Text style={styles.eyebrow}>
          <Trans>Sorting historical inbox</Trans>
        </Text>
      </View>
      <Text style={styles.title}>
        {isRunning ? (
          <Trans>Loading past threads…</Trans>
        ) : (
          <Trans>Sorting your backlog…</Trans>
        )}
      </Text>
      <Text style={styles.desc}>
        {awaitingTaxonomy ? (
          <Trans>Your past threads are being loaded and will appear shortly.</Trans>
        ) : batched ? (
          <Trans>Your backlog is being sorted in batches and will arrive over the next few hours.</Trans>
        ) : (
          <Trans>New threads will appear as they are sorted.</Trans>
        )}
      </Text>
      <IndeterminateBar />
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

/** A slice that slides across the track to signal activity before the estimate lands. */
function IndeterminateBar() {
  const [trackWidth, setTrackWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (trackWidth === 0) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [x, trackWidth]);

  const sliceWidth = Math.max(trackWidth * 0.4, 24);
  const translateX = x.interpolate({
    inputRange: [0, 1],
    outputRange: [-sliceWidth, trackWidth],
  });

  return (
    <View
      style={styles.progressTrack}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[styles.progressBar, { width: sliceWidth, transform: [{ translateX }] }]}
      />
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
  desc: {
    fontSize: fontSize.sm,
    color: colors.ink3,
    marginTop: space.xxs,
    lineHeight: 18,
  },
  progressTrack: {
    marginTop: space.sm,
    height: 4,
    backgroundColor: colors.line2,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    minWidth: 4,
  },
});
