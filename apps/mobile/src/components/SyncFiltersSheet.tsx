import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import type { ApiClient, GmailSyncSettings } from '@amarnai/api-client';
import { SheetLayout } from './SheetLayout';

type Props = {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  client: ApiClient;
  syncSettings: GmailSyncSettings | null;
  onChange: (settings: GmailSyncSettings) => void;
};

export function SyncFiltersSheet({
  visible,
  onClose,
  workspaceId,
  client,
  syncSettings,
  onChange,
}: Props) {
  const { i18n } = useLingui();
  const [updating, setUpdating] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanDone, setRescanDone] = useState(false);

  // Snapshot the filters as of the last open so "Rescan inbox" only enables once
  // a filter actually changes. Snapshot on open (not on every prop change) so
  // saving a toggle mid-session does not reset the dirty state.
  const [initialSettings, setInitialSettings] = useState<GmailSyncSettings | null>(syncSettings);
  const [localSettings, setLocalSettings] = useState<GmailSyncSettings | null>(syncSettings);

  useEffect(() => {
    if (!visible) return;
    setLocalSettings(syncSettings);
    setInitialSettings(syncSettings);
    setRescanDone(false);
    // Snapshot only when the sheet opens; syncSettings is the stable trigger.
  }, [visible]);

  const dirty =
    !!localSettings &&
    !!initialSettings &&
    (localSettings.includeSpam !== initialSettings.includeSpam ||
      localSettings.includePromotions !== initialSettings.includePromotions);

  async function handleToggle(
    field: 'includeSpam' | 'includePromotions' | 'routeBulkToOther',
    value: boolean
  ) {
    if (!localSettings) return;
    const previous = localSettings;
    setLocalSettings({ ...localSettings, [field]: value });
    setUpdating(true);
    try {
      const updated = await client.updateGmailSyncSettings(workspaceId, { [field]: value });
      setLocalSettings(updated);
      onChange(updated);
    } catch {
      setLocalSettings(previous);
      Alert.alert(i18n._(msg`Update failed`), i18n._(msg`Could not save filter setting. Please try again.`));
    } finally {
      setUpdating(false);
    }
  }

  async function handleRescan() {
    setRescanning(true);
    setRescanDone(false);
    try {
      await client.sweepInbox(workspaceId);
      setRescanDone(true);
      setInitialSettings(localSettings);
    } catch {
      Alert.alert(i18n._(msg`Rescan failed`), i18n._(msg`Could not queue rescan. Please try again.`));
    } finally {
      setRescanning(false);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Sync filters`)}>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.hint}>
            <Trans>Controls which Gmail threads are imported. Trash is always excluded.</Trans>
          </Text>

          {localSettings ? (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}><Trans>Include spam</Trans></Text>
                <Switch
                  value={localSettings.includeSpam}
                  onValueChange={(v) => void handleToggle('includeSpam', v)}
                  disabled={updating}
                  trackColor={{ false: colors.line2, true: colors.accentLine }}
                  thumbColor={localSettings.includeSpam ? colors.accent : colors.ink4}
                />
              </View>

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}><Trans>Include Promotions</Trans></Text>
                <Switch
                  value={localSettings.includePromotions}
                  onValueChange={(v) => void handleToggle('includePromotions', v)}
                  disabled={updating}
                  trackColor={{ false: colors.line2, true: colors.accentLine }}
                  thumbColor={localSettings.includePromotions ? colors.accent : colors.ink4}
                />
              </View>

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}><Trans>Auto-file notifications to Updates / Other</Trans></Text>
                <Switch
                  value={localSettings.routeBulkToOther}
                  onValueChange={(v) => void handleToggle('routeBulkToOther', v)}
                  disabled={updating}
                  trackColor={{ false: colors.line2, true: colors.accentLine }}
                  thumbColor={localSettings.routeBulkToOther ? colors.accent : colors.ink4}
                />
              </View>
              <Text style={styles.hint}>
                <Trans>
                  Detected notifications, newsletters, and service updates are filed to your
                  catch-all folder without using AI. Requires the{' '}
                  <Text style={styles.hintStrong}>Updates / Other</Text> folder from a taxonomy
                  template.
                </Trans>
              </Text>

              <TouchableOpacity
                style={[styles.rescanBtn, (!dirty || rescanning) && styles.btnDisabled]}
                onPress={() => void handleRescan()}
                disabled={!dirty || rescanning}
              >
                {rescanning ? (
                  <ActivityIndicator size="small" color={colors.ink3} />
                ) : (
                  <Text style={styles.rescanBtnText}><Trans>Rescan inbox</Trans></Text>
                )}
              </TouchableOpacity>
              {rescanDone ? (
                <Text style={styles.rescanFeedback}>
                  <Trans>Rescan queued. Threads will update shortly.</Trans>
                </Text>
              ) : null}
              <Text style={styles.hint}>
                <Trans>
                  Use "Rescan inbox" after changing filters to apply them to threads already in
                  your inbox.
                </Trans>
              </Text>
            </>
          ) : (
            <Text style={styles.infoText}>
              <Trans>Connect a Gmail inbox to configure sync filters.</Trans>
            </Text>
          )}
      </ScrollView>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.xl,
    flexShrink: 1,
  },
  bodyContent: {
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.ink4,
  },
  hintStrong: {
    fontWeight: fontWeight.medium,
  },
  infoText: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    fontSize: fontSize.md,
    color: colors.ink,
  },
  rescanBtn: {
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSoft,
    minHeight: 40,
  },
  rescanBtnText: {
    fontSize: fontSize.md,
    color: colors.ink2,
    fontWeight: fontWeight.medium,
  },
  rescanFeedback: {
    fontSize: fontSize.sm,
    color: colors.ok,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
