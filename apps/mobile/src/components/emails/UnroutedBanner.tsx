import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg, plural } from '@lingui/core/macro';
import { TAXONOMY_MIN_NON_ROOT_NODES } from '@aziru/shared';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';

interface UnroutedBannerProps {
  waitingCount: number;
  routableFolderCount: number;
  /** True once the user has started backfill routing (from sync-status). */
  routingStarted: boolean;
  onRouteNow: () => void;
}

export function UnroutedBanner({ waitingCount, routableFolderCount, routingStarted, onRouteNow }: UnroutedBannerProps) {
  const router = useRouter();
  const { i18n } = useLingui();
  const [routing, setRouting] = useState(false);
  // Optimistic: hide immediately on press so the banner does not linger while the
  // in-flight import keeps committing PENDING threads (sync-status confirms it on
  // its next poll via routingStarted).
  const [started, setStarted] = useState(false);

  if (waitingCount === 0) return null;

  const taxonomyWeak = routableFolderCount < TAXONOMY_MIN_NON_ROOT_NODES;

  async function handleStartSorting() {
    setRouting(true);
    setStarted(true);
    onRouteNow();
    // optimistic: reset after a short delay (the handler is fire-and-forget)
    setTimeout(() => setRouting(false), 2000);
  }

  if (taxonomyWeak) {
    return (
      <View style={[styles.banner, styles.bannerWarn]}>
        <Text style={styles.warnText} numberOfLines={2}>
          {i18n._(
            msg`${plural(waitingCount, {
              one: '# thread is waiting.',
              other: '# threads are waiting.',
            })} Connect at least ${TAXONOMY_MIN_NON_ROOT_NODES} folders to begin sorting.`,
          )}
        </Text>
        <TouchableOpacity
          style={styles.btnWarn}
          onPress={() => router.push('/(app)/(tabs)/plan')}
        >
          <Text style={styles.btnWarnText}>
            <Trans>Build plan</Trans>
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Routing already started: the armed sweep routes whatever the in-flight import
  // commits next, so the start CTA is done — hide it instead of letting newly
  // imported PENDING threads keep it on screen until the import finishes.
  if (routingStarted || started) return null;

  return (
    <View style={[styles.banner, styles.bannerOk]}>
      <Text style={styles.okText}>
        {i18n._(
          msg`${plural(waitingCount, {
            one: '# thread is ready to sort into your folders.',
            other: '# threads are ready to sort into your folders.',
          })}`,
        )}
      </Text>
      <TouchableOpacity
        style={styles.btnOk}
        onPress={handleStartSorting}
        disabled={routing}
      >
        <Text style={styles.btnOkText}>
          {routing ? <Trans>Starting…</Trans> : <Trans>Start sorting</Trans>}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space.xl,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: space.md,
  },
  bannerWarn: {
    backgroundColor: colors.warnSoft,
    borderColor: colors.warnLine,
  },
  bannerOk: {
    backgroundColor: colors.okSoft,
    borderColor: colors.okLine,
  },
  warnText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.warnInk,
  },
  okText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.okInk,
  },
  btnWarn: {
    backgroundColor: colors.warnInk,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  btnWarnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
  btnOk: {
    backgroundColor: colors.okInk,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  btnOkText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
});
