import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { ApiClient } from '@amarnai/api-client';
import { requestGoogleAuth } from './googleAuth';
import { toUserMessage } from '../errors';

// Runs the full in-app connect flow:
//   Google Sign-In -> POST /workspaces/:id/gmail-connection -> onSuccess()
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
        if (err instanceof Error && err.message === 'cancelled') return;
        Alert.alert('Connect failed', toUserMessage(err, 'Could not connect Gmail. Please try again.'));
      } finally {
        setConnecting(false);
      }
    },
    [workspaceId, client],
  );

  return { connect, connecting };
}
