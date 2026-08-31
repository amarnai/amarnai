import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { colors, radii, space, fontSize, fontWeight } from '@aziru/tokens';
import type { ApiClient, GmailConnection } from '@aziru/api-client';
import { useConnectGmail } from '../../auth/useConnectGmail';

interface DisconnectedBannerProps {
  connection: GmailConnection | null | undefined;
  workspaceId: string;
  client: ApiClient;
  // Called after a successful reconnect so the screen can refetch the connection
  // and refresh the thread list.
  onReconnected: () => void;
}

/**
 * Shown on the emails screen when the workspace's Gmail connection has been
 * disconnected (e.g. its refresh token was revoked or expired). Without this the
 * inbox silently shows stale threads with no indication that syncing has stopped.
 * Offers a one-tap in-app reconnect via the same PKCE flow as the settings sheet.
 */
export function DisconnectedBanner({
  connection,
  workspaceId,
  client,
  onReconnected,
}: DisconnectedBannerProps) {
  const { connect, connecting } = useConnectGmail(workspaceId, client);

  if (connection?.status !== 'DISCONNECTED') return null;

  function handleReconnect() {
    void connect(onReconnected);
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.text} numberOfLines={2}>
        <Trans>
          Gmail disconnected. Aziru stopped syncing this inbox, so new mail will
          not appear until you reconnect.
        </Trans>
      </Text>
      <TouchableOpacity style={styles.btn} onPress={handleReconnect} disabled={connecting}>
        <Text style={styles.btnText}>
          {connecting ? <Trans>Reconnecting…</Trans> : <Trans>Reconnect</Trans>}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space.xl,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: space.md,
    backgroundColor: colors.dangerSoft,
    borderColor: colors.dangerLine,
  },
  text: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.dangerInk,
  },
  btn: {
    backgroundColor: colors.danger,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  btnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.surface,
  },
});
