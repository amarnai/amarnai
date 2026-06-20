import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { ApiClient } from '@amarnai/api-client';
import { requestGoogleAuth } from './googleAuth';

// Runs the full in-app connect flow:
//   PKCE browser prompt -> POST /workspaces/:id/gmail-connection -> onSuccess()
// Cancelled by the user is silently swallowed; other errors surface as an Alert.
export function useConnectGmail(workspaceId: string, client: ApiClient) {
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(
    async (onSuccess?: () => void) => {
      setConnecting(true);
      try {
        const authResult = await requestGoogleAuth();
        await client.connectGmail(workspaceId, authResult);
        onSuccess?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not connect Gmail';
        if (msg !== 'cancelled') {
          Alert.alert('Connect failed', msg);
        }
      } finally {
        setConnecting(false);
      }
    },
    [workspaceId, client],
  );

  return { connect, connecting };
}
