import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trans, Plural } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
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
  if (date.getFullYear() !== now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
function statusBadge(thread: ThreadItem): { label: MessageDescriptor; bg: string; fg: string } {
  if (thread.doneMark) return { label: msg`Done`, bg: colors.okSoft, fg: colors.okInk };
  // Batch-API backfill threads (status "scheduled" / BATCH_PENDING) read as
  // "Sorting" — queued for sorting, no distinct user-facing state.
  if (thread.isClassifying || thread.status === 'scheduled') {
    return { label: msg`Sorting`, bg: colors.bgSunk, fg: colors.ink3 };
  }
  switch (thread.status) {
    case 'review':
      return { label: msg`Needs review`, bg: colors.warnSoft, fg: colors.warnInk };
    case 'unclassified':
      return { label: msg`Unclassified`, bg: colors.dangerSoft, fg: colors.dangerInk };
    case 'unrouted':
    case 'unsorted':
      return { label: msg`Waiting`, bg: colors.bgSunk, fg: colors.ink3 };
    case 'sorted':
      return { label: msg`Sorted`, bg: colors.okSoft, fg: colors.okInk };
  }
}

export function ThreadRow({ thread, onPress }: ThreadRowProps) {
  const { i18n } = useLingui();
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
          <Text style={[styles.badgeText, { color: badge.fg }]}>{i18n._(badge.label)}</Text>
        </View>
        {thread.isDrafting ? (
          <View style={styles.draftPill}>
            <Text style={styles.draftPillText}><Trans>Drafting…</Trans></Text>
          </View>
        ) : thread.hasDraft ? (
          <View style={[styles.draftPill, styles.draftPillAccent]}>
            <Text style={[styles.draftPillText, styles.draftPillTextAccent]}><Trans>Draft</Trans></Text>
          </View>
        ) : null}
        {thread.confidence > 0 && (thread.status === 'sorted' || thread.status === 'review') ? (
          <View style={[styles.confidenceDot, { backgroundColor: confidenceDotColor(thread.confidence) }]} />
        ) : null}
        {thread.attachmentCount > 0 ? (
          <Text style={styles.attachCount}>
            <Plural value={thread.attachmentCount} one="# file" other="# files" />
          </Text>
        ) : null}
        {thread.messageCount > 1 ? (
          <Text style={styles.msgCount}>
            <Plural value={thread.messageCount} one="# message" other="# messages" />
          </Text>
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
