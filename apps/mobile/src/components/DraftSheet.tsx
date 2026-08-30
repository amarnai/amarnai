import { useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, fontSize, fontWeight, radii, space } from '@aziru/tokens';
import type { Draft, QuotaInfo } from '@aziru/api-client';
import { formatQuotaResetDate } from '@aziru/shared';
import { SheetLayout } from './SheetLayout';

interface DraftSheetProps {
  visible: boolean;
  onClose: () => void;
  draft: Draft;
  quota: QuotaInfo | null;
  providerThreadId: string;
  onToggleSent: () => void;
  onRegenerate: () => void;
  onCopied: () => void;
}

export function DraftSheet({
  visible,
  onClose,
  draft,
  quota,
  providerThreadId,
  onToggleSent,
  onRegenerate,
  onCopied,
}: DraftSheetProps) {
  const { i18n } = useLingui();
  const [shared, setShared] = useState(false);

  const isSent = draft.status === 'SENT';
  const quotaExhausted = quota != null && quota.used >= quota.limit;
  const resetDate = quota ? formatQuotaResetDate(quota.resetsAt) : null;
  const remaining = quota ? quota.limit - quota.used : 0;
  const limit = quota?.limit ?? 0;

  async function handleShare() {
    try {
      const result = await Share.share({ message: draft.body });
      // Only confirm on an actual share. NOTE: Android's OS share API resolves
      // with sharedAction even when the user dismisses the sheet, so the false
      // positive cannot be fully eliminated there — a platform limitation.
      if (result.action === Share.dismissedAction) return;
      setShared(true);
      onCopied();
      setTimeout(() => setShared(false), 2000);
    } catch {
      // user cancel / share error: show no success feedback
    }
  }

  function handleOpenGmail() {
    const url = `https://mail.google.com/mail/u/0/#all/${providerThreadId}`;
    Linking.openURL(url).catch(() => {});
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Draft reply`)} handle>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {draft.subject ? (
          <Text style={styles.subject}>{draft.subject}</Text>
        ) : null}

        <Text style={styles.body}>{draft.body}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={handleShare}
            activeOpacity={0.75}
          >
            <Ionicons
              name={shared ? 'checkmark' : 'share-outline'}
              size={16}
              color={colors.bg}
            />
            <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>
              {shared ? <Trans>Shared</Trans> : <Trans>Share / Copy</Trans>}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleOpenGmail}
            activeOpacity={0.75}
          >
            <Ionicons name="mail-outline" size={16} color={colors.ink2} />
            <Text style={styles.actionBtnText}><Trans>Open in Gmail</Trans></Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={onToggleSent}
            activeOpacity={0.75}
          >
            <Ionicons
              name={isSent ? 'close-circle-outline' : 'checkmark-circle-outline'}
              size={16}
              color={colors.ink2}
            />
            <Text style={styles.actionBtnText}>
              {isSent ? <Trans>Mark as unsent</Trans> : <Trans>Mark as sent</Trans>}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, quotaExhausted && styles.actionBtnDisabled]}
            onPress={quotaExhausted ? undefined : onRegenerate}
            activeOpacity={quotaExhausted ? 1 : 0.75}
            disabled={quotaExhausted}
          >
            <Ionicons
              name="refresh-outline"
              size={16}
              color={quotaExhausted ? colors.ink5 : colors.ink2}
            />
            <Text style={[styles.actionBtnText, quotaExhausted && styles.actionBtnTextDisabled]}>
              <Trans>Regenerate</Trans>
            </Text>
          </TouchableOpacity>
        </View>

        {quota != null && (
          <Text style={[styles.quota, quotaExhausted && styles.quotaExhausted]}>
            {quotaExhausted ? (
              <Trans>No drafts remaining · resets {resetDate}</Trans>
            ) : (
              <Trans>{remaining} of {limit} remaining · resets {resetDate}</Trans>
            )}
          </Text>
        )}
      </ScrollView>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
  },
  subject: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
    marginBottom: space.sm,
  },
  body: {
    fontSize: fontSize.base,
    color: colors.ink2,
    lineHeight: 22,
  },
  actions: {
    marginTop: space.xl,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.bg,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionBtnDisabled: {
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
  },
  actionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.ink2,
  },
  actionBtnTextPrimary: {
    color: colors.bg,
  },
  actionBtnTextDisabled: {
    color: colors.ink5,
  },
  quota: {
    marginTop: space.md,
    fontSize: fontSize.xs,
    color: colors.ink4,
  },
  quotaExhausted: {
    color: colors.dangerInk,
  },
});
