import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { FolderItem, ThreadItem } from '@amarnai/core';

interface RationaleCardProps {
  thread: ThreadItem;
  folders: FolderItem[];
  explanation: string | null;
  onApprove: () => void;
  onReroute: () => void;
}

// RN equivalent of the web RationaleCard: shows the AI routing destination,
// confidence, and reasoning, with Approve / Move actions. Mirrors the web
// states (sorting, waiting, sorted) without the embedding-source nuance.
export function RationaleCard({
  thread,
  folders,
  explanation,
  onApprove,
  onReroute,
}: RationaleCardProps) {
  const folder = folders.find((f) => f.id === thread.folderId);
  const unrouted = !folder;
  const confPct = Math.round(thread.confidence * 100);

  if (thread.isClassifying) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>AI Routing</Text>
        <Text style={styles.dest}>Sorting…</Text>
      </View>
    );
  }

  if (thread.status === 'unrouted' || thread.status === 'unsorted') {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>AI Routing</Text>
        <Text style={styles.dest}>Waiting</Text>
        <Text style={styles.reasonMuted}>
          This thread is waiting to be routed.
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onReroute}>
            <Text style={styles.secondaryBtnText}>Move to…</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>AI Routing</Text>
        {!unrouted ? <Text style={styles.conf}>{confPct}% confidence</Text> : null}
      </View>

      <Text style={styles.dest}>{folder?.name ?? 'Unrouted'}</Text>

      {thread.isImportant ? (
        <Text style={styles.important}>Gmail marked as important</Text>
      ) : null}

      {explanation ? <Text style={styles.reason}>{explanation}</Text> : null}

      <View style={styles.actions}>
        {thread.status !== 'sorted' && !unrouted ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={onApprove}>
            <Text style={styles.primaryBtnText}>Approve routing</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.secondaryBtn} onPress={onReroute}>
          <Text style={styles.secondaryBtnText}>Move to…</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.lg,
    padding: space.lg,
    marginHorizontal: space.xl,
    marginTop: space.lg,
    gap: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
    textTransform: 'uppercase',
  },
  conf: {
    fontSize: fontSize.xs,
    color: colors.ink4,
  },
  dest: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  important: {
    fontSize: fontSize.sm,
    color: colors.warnInk,
  },
  reason: {
    fontSize: fontSize.md,
    color: colors.ink2,
    lineHeight: 20,
  },
  reasonMuted: {
    fontSize: fontSize.md,
    color: colors.ink3,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xs,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  primaryBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accentInk,
  },
  secondaryBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  secondaryBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.ink,
  },
});
