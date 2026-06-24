import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { ThreadItem } from '@amarnai/core';

interface ThreadRowProps {
  thread: ThreadItem;
  onPress: () => void;
}

// Short, dependency-free timestamp: time of day for today, otherwise a short date.
function formatTime(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Mirrors the web confidence donut thresholds: green ≥80%, yellow 60–80%, red <60%.
function confidenceDotColor(confidence: number): string {
  if (confidence >= 0.8) return colors.okInk;
  if (confidence >= 0.6) return colors.warnInk;
  return colors.dangerInk;
}

// Maps a thread's triage state to a single badge (label + colors from tokens),
// mirroring the web row's status chip wording.
function statusBadge(thread: ThreadItem): { label: string; bg: string; fg: string } {
  if (thread.doneMark) return { label: 'Done', bg: colors.okSoft, fg: colors.okInk };
  if (thread.isClassifying) return { label: 'Sorting', bg: colors.bgSunk, fg: colors.ink3 };
  switch (thread.status) {
    case 'review':
      return { label: 'Needs review', bg: colors.warnSoft, fg: colors.warnInk };
    case 'unclassified':
      return { label: 'Unclassified', bg: colors.dangerSoft, fg: colors.dangerInk };
    case 'unrouted':
    case 'unsorted':
      return { label: 'Waiting', bg: colors.bgSunk, fg: colors.ink3 };
    case 'sorted':
      return { label: 'Sorted', bg: colors.okSoft, fg: colors.okInk };
  }
}

export function ThreadRow({ thread, onPress }: ThreadRowProps) {
  const badge = statusBadge(thread);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.topLine}>
        <Text style={styles.from} numberOfLines={1}>
          {thread.participants}
        </Text>
        <Text style={styles.time}>{formatTime(thread.latestAt)}</Text>
      </View>

      <Text style={styles.subject} numberOfLines={1}>
        {thread.subject}
      </Text>

      {thread.snippet ? (
        <Text style={styles.snippet} numberOfLines={2}>
          {thread.snippet}
        </Text>
      ) : null}

      <View style={styles.metaLine}>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
        {thread.isDrafting ? (
          <View style={styles.draftPill}>
            <Text style={styles.draftPillText}>Drafting…</Text>
          </View>
        ) : thread.hasDraft ? (
          <View style={[styles.draftPill, styles.draftPillAccent]}>
            <Text style={[styles.draftPillText, styles.draftPillTextAccent]}>Draft</Text>
          </View>
        ) : null}
        {thread.confidence > 0 && (thread.status === 'sorted' || thread.status === 'review') ? (
          <View style={[styles.confidenceDot, { backgroundColor: confidenceDotColor(thread.confidence) }]} />
        ) : null}
        {thread.attachmentCount > 0 ? (
          <Text style={styles.attachCount}>
            {thread.attachmentCount} {thread.attachmentCount === 1 ? 'file' : 'files'}
          </Text>
        ) : null}
        {thread.messageCount > 1 ? (
          <Text style={styles.msgCount}>{thread.messageCount} messages</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    gap: space.xxs,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  from: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.ink2,
    flex: 1,
    marginRight: space.md,
  },
  time: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  subject: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    color: colors.ink,
  },
  snippet: {
    fontSize: fontSize.base,
    color: colors.ink3,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xs,
    gap: space.md,
  },
  badge: {
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  confidenceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  attachCount: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  msgCount: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  draftPill: {
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
    backgroundColor: colors.bgSunk,
  },
  draftPillAccent: {
    backgroundColor: colors.accentSoft,
  },
  draftPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.ink3,
  },
  draftPillTextAccent: {
    color: colors.accentInk,
  },
});
