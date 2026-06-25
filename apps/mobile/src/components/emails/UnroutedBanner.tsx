import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TAXONOMY_MIN_NON_ROOT_NODES } from '@amarnai/shared';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';

interface UnroutedBannerProps {
  waitingCount: number;
  routableFolderCount: number;
  onRouteNow: () => void;
}

export function UnroutedBanner({ waitingCount, routableFolderCount, onRouteNow }: UnroutedBannerProps) {
  const router = useRouter();
  const [routing, setRouting] = useState(false);

  if (waitingCount === 0) return null;

  const taxonomyWeak = routableFolderCount < TAXONOMY_MIN_NON_ROOT_NODES;

  async function handleRouteNow() {
    setRouting(true);
    onRouteNow();
    // optimistic: reset after a short delay (the handler is fire-and-forget)
    setTimeout(() => setRouting(false), 2000);
  }

  if (taxonomyWeak) {
    return (
      <View style={[styles.banner, styles.bannerWarn]}>
        <Text style={styles.warnText} numberOfLines={2}>
          {waitingCount} thread{waitingCount !== 1 ? 's are' : ' is'} waiting.
          Connect at least {TAXONOMY_MIN_NON_ROOT_NODES} folders to begin sorting.
        </Text>
        <TouchableOpacity
          style={styles.btnWarn}
          onPress={() => router.push('/(app)/(tabs)/plan')}
        >
          <Text style={styles.btnWarnText}>Build plan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.bannerOk]}>
      <Text style={styles.okText}>
        {waitingCount} thread{waitingCount !== 1 ? 's are' : ' is'} ready to route.
      </Text>
      <TouchableOpacity
        style={styles.btnOk}
        onPress={handleRouteNow}
        disabled={routing}
      >
        <Text style={styles.btnOkText}>{routing ? 'Routing…' : 'Route now'}</Text>
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
