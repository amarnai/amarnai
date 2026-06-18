import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@amarnai/tokens';
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
        {thread.messageCount > 1 ? (
          <Text style={styles.msgCount}>{thread.messageCount} messages</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    gap: 3,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  from: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink2,
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 12,
    color: colors.ink4,
  },
  subject: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.ink,
  },
  snippet: {
    fontSize: 13,
    color: colors.ink3,
    lineHeight: 18,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  msgCount: {
    fontSize: 12,
    color: colors.ink4,
  },
});
