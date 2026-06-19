import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import type { ApiClient, QuotaInfo } from '@amarnai/api-client';

type Props = {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  client: ApiClient;
  planLabel: string;
};

function UsageRow({ label, quota }: { label: string; quota: QuotaInfo | null }) {
  if (!quota) {
    return (
      <View style={styles.usageRow}>
        <Text style={styles.usageLabel}>{label}</Text>
        <Text style={styles.usageValue}>—</Text>
      </View>
    );
  }
  const pct = quota.limit > 0 ? Math.min(1, quota.used / quota.limit) : 0;
  return (
    <View style={styles.usageBlock}>
      <View style={styles.usageRow}>
        <Text style={styles.usageLabel}>{label}</Text>
        <Text style={styles.usageValue}>
          {quota.used} / {quota.limit}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

export function PlanSheet({ visible, onClose, workspaceId, client, planLabel }: Props) {
  const [loading, setLoading] = useState(true);
  const [draftQuota, setDraftQuota] = useState<QuotaInfo | null>(null);
  const [threadSortQuota, setThreadSortQuota] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      client.draftQuota(workspaceId),
      client.threadSortQuota(workspaceId),
    ]).then(([draftResult, sortResult]) => {
      if (cancelled) return;
      setDraftQuota(draftResult.status === 'fulfilled' ? draftResult.value : null);
      setThreadSortQuota(sortResult.status === 'fulfilled' ? sortResult.value : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, workspaceId, client]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Plan &amp; usage</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <View style={styles.planRow}>
              <Text style={styles.planLabel}>Current plan</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>{planLabel}</Text>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator style={styles.loader} color={colors.ink4} />
            ) : (
              <>
                <Text style={styles.sectionLabel}>This month</Text>
                <UsageRow label="AI drafts" quota={draftQuota} />
                <UsageRow label="Threads sorted" quota={threadSortQuota} />
              </>
            )}

            <Text style={styles.note}>
              Upgrades, downgrades, and billing are managed on the web app.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  close: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  body: {
    paddingHorizontal: space.xl,
  },
  bodyContent: {
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planLabel: {
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
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  loader: {
    marginVertical: space.lg,
  },
  usageBlock: {
    gap: space.xs,
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  usageLabel: {
    fontSize: fontSize.md,
    color: colors.ink,
  },
  usageValue: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  barTrack: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.bgSunk,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  note: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
});
