import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { makeApiClient, type ApiClient } from '@amarnai/api-client';
import { API_BASE_URL } from '../config';
import { readUserIdFromAccessToken } from './jwt';
import { secureTokenStore, type StoredTokens } from './tokenStore';
import { makeMobileTransport } from './transport';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  userId: string | null;
  workspaceId: string | null;
  client: ApiClient;
  // Throws on invalid credentials so the sign-in screen can show the error.
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function login(email: string, password: string): Promise<StoredTokens> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401) throw new Error('Invalid email or password');
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  return (await res.json()) as StoredTokens;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Stable across the app's lifetime: the transport reads the current tokens
  // from the store per request, so the same client works before and after
  // sign-in. onAuthFailure (a failed refresh) flips the session to signed-out.
  const signOutLocal = useRef(() => {
    setStatus('signedOut');
    setUserId(null);
    setWorkspaceId(null);
  });
  const client = useMemo<ApiClient>(
    () =>
      makeApiClient(
        makeMobileTransport({
          baseUrl: API_BASE_URL,
          tokenStore: secureTokenStore,
          onAuthFailure: () => signOutLocal.current(),
        }),
      ),
    [],
  );

  // Resolve the signed-in identity + active workspace from a valid access token.
  const bootstrap = useCallback(
    async (accessToken: string) => {
      setUserId(readUserIdFromAccessToken(accessToken));
      const workspaces = await client.workspaces().catch(() => []);
      setWorkspaceId(workspaces[0]?.id ?? null);
      setStatus('signedIn');
    },
    [client],
  );

  // On launch, restore any stored session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await secureTokenStore.get();
      if (cancelled) return;
      if (!tokens) {
        setStatus('signedOut');
        return;
      }
      await bootstrap(tokens.accessToken);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await login(email, password);
      await secureTokenStore.set(tokens);
      await bootstrap(tokens.accessToken);
    },
    [bootstrap],
  );

  const signOut = useCallback(async () => {
    const tokens = await secureTokenStore.get();
    if (tokens?.refreshToken) {
      // Best-effort server-side revoke; clear local state regardless.
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => {});
    }
    await secureTokenStore.clear();
    signOutLocal.current();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, userId, workspaceId, client, signIn, signOut }),
    [status, userId, workspaceId, client, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
