import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans, Plural } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { ThreadItem } from '@amarnai/core';

interface ThreadRowProps {
  thread: ThreadItem;
  onPress: () => void;
  onToggleImportant: () => void;
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

// Maps a thread's triage state to a single badge (label + colors from tokens),
// mirroring the web row's status chip wording.
function statusBadge(thread: ThreadItem): { label: MessageDescriptor; bg: string; fg: string } {
  if (thread.doneMark) return { label: msg`Done`, bg: colors.okSoft, fg: colors.okInk };
  if (thread.isClassifying) return { label: msg`Sorting`, bg: colors.bgSunk, fg: colors.ink3 };
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

export function ThreadRow({ thread, onPress, onToggleImportant }: ThreadRowProps) {
  const { i18n } = useLingui();
  const badge = statusBadge(thread);
  const assigneeName = thread.assignment
    ? (thread.assignment.userName ?? thread.assignment.userEmail)
    : null;
  const importantLabel = thread.isImportant
    ? i18n._(msg`Remove from important`)
    : i18n._(msg`Mark as important`);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.topLine}>
        <Text style={styles.from} numberOfLines={1}>
          {thread.participants}
        </Text>
        <Text style={styles.time}>{formatTime(thread.latestAt)}</Text>
        <TouchableOpacity
          onPress={onToggleImportant}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={importantLabel}
          accessibilityState={{ selected: thread.isImportant }}
          style={styles.star}
        >
          <Ionicons
            name={thread.isImportant ? 'star' : 'star-outline'}
            size={17}
            color={thread.isImportant ? colors.accent : colors.ink4}
          />
        </TouchableOpacity>
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
        {assigneeName ? (
          <View style={[styles.draftPill, styles.assigneePill]}>
            <Text style={[styles.draftPillText, styles.assigneePillText]} numberOfLines={1}>
              {assigneeName}
            </Text>
          </View>
        ) : null}
        {thread.isDrafting ? (
          <View style={styles.draftPill}>
            <Text style={styles.draftPillText}><Trans>Drafting…</Trans></Text>
          </View>
        ) : thread.hasDraft ? (
          <View style={[styles.draftPill, styles.draftPillAccent]}>
            <Text style={[styles.draftPillText, styles.draftPillTextAccent]}><Trans>Draft</Trans></Text>
          </View>
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
  star: {
    marginLeft: space.md,
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
  assigneePill: {
    backgroundColor: colors.accentSoft,
    maxWidth: 140,
  },
  assigneePillText: {
    color: colors.accentInk,
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
