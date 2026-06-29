import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { colors, radii, space, fontSize, fontWeight } from '@amarnai/tokens';
import type { TaxonomyTransferFile } from '@amarnai/shared';
import type { TaxonomyGenerationStatusResult } from '@amarnai/api-client';
import {
  generationReasonText as reasonText,
  generationPreviewRows as previewRows,
} from '@amarnai/core/taxonomy';
import { SheetLayout } from '../SheetLayout';

interface Props {
  visible: boolean;
  generation: TaxonomyGenerationStatusResult | undefined;
  loading: boolean;
  generating: boolean;
  applying: boolean;
  onGenerate: () => void;
  onApply: (file: TaxonomyTransferFile) => void;
  onUseTemplates: () => void;
  onClose: () => void;
}

// Auto-generate-taxonomy-from-inbox. Mirrors the web flow: trigger → poll →
// preview → apply (destructive replace, with the same cost limiter messaging).
export function GenerateFromInboxSheet({
  visible,
  generation,
  loading,
  generating,
  applying,
  onGenerate,
  onApply,
  onUseTemplates,
  onClose,
}: Props) {
  const { _ } = useLingui();
  const status = generation?.status ?? 'IDLE';
  const eligibility = generation?.eligibility;
  const proposal = status === 'READY' ? generation?.proposal ?? null : null;
  const running = status === 'RUNNING' || generating;
  const importing = generation?.importing ?? false;

  return (
    <SheetLayout visible={visible} onClose={onClose} title={_(msg`Generate from inbox`)} handle>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {importing && !running && eligibility?.eligible ? (
          <Text style={[styles.muted, { marginBottom: space.md }]}>
            <Trans>
              Your inbox is still importing. You can generate now from what&apos;s loaded so far,
              but regenerating once the import finishes will give a more accurate fit.
            </Trans>
          </Text>
        ) : null}
        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : running ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}><Trans>Analyzing your inbox and building a plan…</Trans></Text>
          </View>
        ) : status === 'INSUFFICIENT' ? (
          <Text style={styles.muted}>{reasonText('INBOX_TOO_SMALL')}</Text>
        ) : status === 'FAILED' ? (
          <Text style={styles.muted}>
            {eligibility?.nextEligibleAt ? (
              <Trans>
                Generation didn&apos;t complete. Try again after{' '}
                {new Date(eligibility.nextEligibleAt).toLocaleString()}, or start from a template.
              </Trans>
            ) : (
              <Trans>Generation didn&apos;t complete. Try again shortly, or start from a template.</Trans>
            )}
          </Text>
        ) : proposal ? (
          <View style={styles.gap}>
            <Text style={styles.muted}>
              <Trans>
                Proposed folders. Applying replaces your current plan; you can edit everything
                afterward.
              </Trans>
            </Text>
            {previewRows(proposal).map((row, i) => (
              <View key={`${row.name}-${i}`} style={styles.row}>
                <Text style={styles.name}>
                  {row.name}
                  {row.breadcrumb ? <Text style={styles.crumb}>  {row.breadcrumb}</Text> : null}
                </Text>
                {row.description ? <Text style={styles.desc}>{row.description}</Text> : null}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.gap}>
            <Text style={styles.muted}>
              <Trans>
                Amarnai will analyze your senders, labels, and subject keywords (never message
                bodies) to suggest a personalized set of folders. Review and edit before anything
                is applied.
              </Trans>
            </Text>
            {eligibility && !eligibility.eligible ? (
              <Text style={styles.muted}>
                {reasonText(eligibility.reason, eligibility.nextEligibleAt)}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {proposal ? (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={onClose}
              disabled={applying}
            >
              <Text style={styles.btnGhostText}><Trans>Discard</Trans></Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onApply(proposal)}
              disabled={applying}
            >
              <Text style={styles.btnPrimaryText}>{applying ? <Trans>Applying…</Trans> : <Trans>Apply</Trans>}</Text>
            </TouchableOpacity>
          </>
        ) : status === 'INSUFFICIENT' || status === 'FAILED' ? (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={styles.btnGhostText}><Trans>Close</Trans></Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => {
                onClose();
                onUseTemplates();
              }}
            >
              <Text style={styles.btnPrimaryText}><Trans>Use a template</Trans></Text>
            </TouchableOpacity>
          </>
        ) : !running ? (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={styles.btnGhostText}><Trans>Close</Trans></Text>
            </TouchableOpacity>
            {eligibility?.eligible ? (
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onGenerate}>
                <Text style={styles.btnPrimaryText}><Trans>Generate</Trans></Text>
              </TouchableOpacity>
            ) : (
              // Inbox isn't eligible to generate; offer a template as the path forward.
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => {
                  onClose();
                  onUseTemplates();
                }}
              >
                <Text style={styles.btnPrimaryText}><Trans>Use a template</Trans></Text>
              </TouchableOpacity>
            )}
          </>
        ) : null}
      </View>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
  center: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  gap: { gap: space.md },
  muted: { fontSize: fontSize.sm, color: colors.ink3 },
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    paddingTop: space.md,
    gap: space.xxs,
  },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.ink },
  crumb: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, color: colors.ink4 },
  desc: { fontSize: fontSize.sm, color: colors.ink3 },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  btn: { flex: 1, borderRadius: radii.md, paddingVertical: space.lg, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.surface, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  btnGhost: { backgroundColor: colors.bgSunk },
  btnGhostText: { color: colors.ink2, fontSize: fontSize.md, fontWeight: fontWeight.medium },
});
