import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';
import type { ThreadMessage } from '@aziru/core';

interface MessageCardProps {
  message: ThreadMessage;
  defaultExpanded?: boolean;
  loading?: boolean;
}

function fmtDateTime(d: Date): string {
  const crossYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(crossYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
}

// RN equivalent of the web MessageCard: a collapsible message with header
// (sender + time) and, when expanded, the body text (or snippet/loading).
export function MessageCard({ message, defaultExpanded = false, loading = false }: MessageCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <View style={styles.headerText}>
          <Text style={styles.from} numberOfLines={1}>
            {message.fromName || message.fromEmail}
          </Text>
          {!expanded && message.snippet ? (
            <Text style={styles.snippet} numberOfLines={1}>
              {message.snippet}
            </Text>
          ) : null}
        </View>
        <Text style={styles.time}>{fmtDateTime(message.time)}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.body}>
          {message.fromEmail !== message.fromName ? (
            <Text style={styles.fromEmail}>{message.fromEmail}</Text>
          ) : null}
          {message.bodyText ? (
            <Text style={styles.text}>{message.bodyText}</Text>
          ) : loading ? (
            <Text style={styles.muted}><Trans>Loading…</Trans></Text>
          ) : message.snippet ? (
            <Text style={styles.text}>{message.snippet}</Text>
          ) : (
            <Text style={styles.muted}><Trans>(No body)</Trans></Text>
          )}
          {message.attachments && message.attachments.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachmentList} contentContainerStyle={styles.attachmentListContent}>
              {message.attachments.map((a, i) => (
                <View key={a.filename ?? `${a.mimeType}-${i}`} style={styles.attachmentChip}>
                  <Text style={styles.attachmentText} numberOfLines={1}>
                    {a.filename ?? a.mimeType}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.lg,
    marginHorizontal: space.xl,
    marginTop: space.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.lg,
    gap: space.md,
  },
  headerText: {
    flex: 1,
    gap: space.xxs,
  },
  from: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  snippet: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  time: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    paddingTop: space.lg,
  },
  fromEmail: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  text: {
    fontSize: fontSize.md,
    color: colors.ink2,
    lineHeight: 21,
  },
  muted: {
    fontSize: fontSize.md,
    color: colors.ink4,
    fontStyle: 'italic',
  },
  attachmentList: {
    marginTop: space.sm,
  },
  attachmentListContent: {
    flexDirection: 'row',
    gap: space.xs,
  },
  attachmentChip: {
    backgroundColor: colors.bgSunk,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  attachmentText: {
    fontSize: fontSize.xs,
    color: colors.ink3,
  },
});
