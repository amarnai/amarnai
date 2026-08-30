import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { I18n, MessageDescriptor } from '@lingui/core';
import { colors, space, fontSize, fontWeight, radii } from '@aziru/tokens';
import type { ApiClient, GmailConnection, SyncStatus } from '@aziru/api-client';
import { SheetLayout } from './SheetLayout';
import { useConnectGmail } from '../auth/useConnectGmail';

type Props = {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  client: ApiClient;
  connection: GmailConnection;
  syncStatus: SyncStatus;
  onDisconnected: () => void;
  onConnected?: () => void;
};

function formatDate(iso: string | null, i18n: I18n): string {
  if (!iso) return i18n._(msg`Never`);
  return new Date(iso).toLocaleString();
}

const SYNC_LABEL: Record<'IDLE' | 'SYNCING' | 'ERROR', MessageDescriptor> = {
  IDLE: msg`Up to date`,
  SYNCING: msg`Syncing…`,
  ERROR: msg`Sync error`,
};

const SYNC_COLOR: Record<'IDLE' | 'SYNCING' | 'ERROR', string> = {
  IDLE: colors.ok,
  SYNCING: colors.accent,
  ERROR: colors.danger,
};

const SYNC_BG: Record<'IDLE' | 'SYNCING' | 'ERROR', string> = {
  IDLE: colors.okSoft,
  SYNCING: colors.accentSoft,
  ERROR: colors.dangerSoft,
};

export function GmailSettingsSheet({
  visible,
  onClose,
  workspaceId,
  client,
  connection,
  syncStatus,
  onDisconnected,
  onConnected,
}: Props) {
  const { i18n } = useLingui();
  const [disconnecting, setDisconnecting] = useState(false);
  const { connect, connecting } = useConnectGmail(workspaceId, client);

  function handleConnect() {
    void connect(() => {
      onConnected?.();
      onClose();
    });
  }

  async function doDisconnect(eraseData: boolean) {
    setDisconnecting(true);
    try {
      await client.disconnectGmail(workspaceId, eraseData);
      onDisconnected();
      onClose();
    } catch {
      Alert.alert(i18n._(msg`Disconnect failed`), i18n._(msg`Could not disconnect Gmail. Please try again.`));
    } finally {
      setDisconnecting(false);
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      i18n._(msg`Disconnect Gmail?`),
      i18n._(msg`Stops syncing and revokes Amarnai's access to this mailbox.`),
      [
        { text: i18n._(msg`Cancel`), style: 'cancel' },
        { text: i18n._(msg`Disconnect`), onPress: () => void doDisconnect(false) },
        {
          text: i18n._(msg`Disconnect & erase data`),
          style: 'destructive',
          onPress: () => void doDisconnect(true),
        },
      ],
    );
  }

  const statusKey = syncStatus?.status ?? 'IDLE';

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Inbox`)}>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {!connection || connection.status === 'DISCONNECTED' ? (
            <>
              {connection?.status === 'DISCONNECTED' ? (
                <>
                  <Text style={styles.gmailAddress}>{connection.gmailAddress}</Text>
                  <Text style={styles.disconnectedBadge}><Trans>Disconnected</Trans></Text>
                </>
              ) : (
                <Text style={styles.infoText}>
                  <Trans>No Gmail inbox connected. Connect your account to start syncing.</Trans>
                </Text>
              )}
              <TouchableOpacity
                style={[styles.connectBtn, connecting && styles.btnDisabled]}
                onPress={handleConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.connectBtnText}>
                    {connection ? <Trans>Reconnect Gmail</Trans> : <Trans>Connect Gmail</Trans>}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Connection header */}
              <Text style={styles.gmailAddress}>{connection.gmailAddress}</Text>
              <Text style={styles.metaText}>
                <Trans>Last verified: {formatDate(connection.lastVerifiedAt, i18n)}</Trans>
              </Text>

              {/* Sync status badge */}
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}><Trans>Inbox sync</Trans></Text>
                <View style={[styles.badge, { backgroundColor: SYNC_BG[statusKey] }]}>
                  <Text style={[styles.badgeText, { color: SYNC_COLOR[statusKey] }]}>
                    {i18n._(SYNC_LABEL[statusKey])}
                  </Text>
                </View>
              </View>
              {syncStatus?.lastSyncedAt ? (
                <Text style={styles.metaText}>
                  <Trans>Last synced {formatDate(syncStatus.lastSyncedAt, i18n)}</Trans>
                </Text>
              ) : null}
              {syncStatus?.status === 'ERROR' && syncStatus.errorMessage ? (
                <Text style={styles.errorText}>{syncStatus.errorMessage}</Text>
              ) : null}

              {/* Disconnect */}
              <TouchableOpacity
                style={[styles.disconnectBtn, disconnecting && styles.btnDisabled]}
                onPress={confirmDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Text style={styles.disconnectBtnText}><Trans>Disconnect Gmail</Trans></Text>
                )}
              </TouchableOpacity>
            </>
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
  infoText: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  gmailAddress: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  disconnectedBadge: {
    fontSize: fontSize.sm,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.ink3,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xxs,
  },
  syncLabel: {
    fontSize: fontSize.md,
    color: colors.ink3,
  },
  badge: {
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
  },
  badgeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  connectBtn: {
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radii.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    minHeight: 40,
  },
  connectBtnText: {
    fontSize: fontSize.md,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  disconnectBtn: {
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: colors.dangerLine,
    borderRadius: radii.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSoft,
    minHeight: 40,
  },
  disconnectBtnText: {
    fontSize: fontSize.md,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
