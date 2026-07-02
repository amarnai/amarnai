import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { makeApiClient, readUserIdFromAccessToken, type ApiClient, type Workspace } from '@amarnai/api-client';
import { API_BASE_URL } from '../config';
import { secureTokenStore, type StoredTokens } from './tokenStore';
import { makeMobileTransport } from './transport';
import { resolveDeviceLocale } from '../i18n/LinguiProvider';
import { requestGoogleAuth } from './googleAuth';
import { confirmCheckout } from '../billing/api';
import { getPendingCheckout, clearPendingCheckout } from '../billing/pendingCheckout';

type Status = 'loading' | 'signedOut' | 'signedIn';

type SessionUser = { email: string; name: string | null };

// Resolve the signed-in user's profile from any workspace they belong to (owner
// or member). The API does not expose a dedicated "me" endpoint, but every
// workspace payload carries the full member list, so the active user is always
// present in the workspaces response.
function findUser(workspaces: Workspace[], userId: string | null): SessionUser | null {
  if (!userId) return null;
  for (const ws of workspaces) {
    if (ws.owner.id === userId) return { email: ws.owner.email, name: ws.owner.name };
    const member = ws.members.find((m) => m.user.id === userId);
    if (member) return { email: member.user.email, name: member.user.name };
  }
  return null;
}

interface SessionValue {
  status: Status;
  userId: string | null;
  user: SessionUser | null;
  // null until /auth/me resolves (or if it fails): treat null as "unknown" and
  // do not gate on it. false means the account exists but is not yet verified.
  emailVerified: boolean | null;
  // Active workspace's language (UI + taxonomy). Follows the selected workspace;
  // null until the workspace list resolves, so callers fall back to device locale.
  locale: string | null;
  workspaceId: string | null;
  workspaces: Workspace[];
  // Bumped to force triage (folders + threads) to re-seed when the active
  // workspace's data changed in place, e.g. after a reset. See AppLayout, which
  // keys the TriageProvider on it.
  dataVersion: number;
  // Switch the active workspace. No-op if the id is not one the user belongs to.
  switchWorkspace(id: string): void;
  // Re-fetch the workspace list (after rename/delete/create); repoints the
  // active workspace if it no longer exists. Pass switchToId to atomically
  // switch to a newly created workspace in the same state update.
  refreshWorkspaces(switchToId?: string): Promise<void>;
  // Force a triage re-seed for the current workspace (after reset).
  bumpDataVersion(): void;
  client: ApiClient;
  // Throws on invalid credentials so the sign-in screen can show the error.
  signIn(email: string, password: string): Promise<void>;
  // Throws on a taken email / closed sign-up so the sign-up screen can show it.
  signUp(email: string, password: string): Promise<void>;
  // Requests a password-reset email. Always resolves (the API never reveals
  // whether an account exists); the reset itself is completed on the web page
  // the email links to.
  requestPasswordReset(email: string): Promise<void>;
  // Runs the native Google Sign-In flow and provisions or signs in the user via
  // /auth/google (which redeems the serverAuthCode). Throws 'cancelled' when the
  // user dismisses the sheet, and a user-facing message for other failures.
  signInWithGoogle(): Promise<void>;
  // Re-resolve identity + verification from the stored token. Used by the
  // verify-email screen to detect when the link has been clicked.
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function login(email: string, password: string): Promise<StoredTokens> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) return (await res.json()) as StoredTokens;
  if (res.status === 401) throw new Error('Invalid email or password');
  // Other failures (e.g. 403 waitlist, 400 validation) carry a user-facing
  // message from the API; surface it verbatim so the cause is explicit.
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? 'Sign-in failed. Please try again.');
}

async function register(email: string, password: string): Promise<StoredTokens> {
  const res = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) return (await res.json()) as StoredTokens;
  // 409 (taken / Google-only), 403 (waitlist), and 400 (validation) all carry a
  // user-facing message from the API; surface it verbatim.
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? 'Sign-up failed. Please try again.');
}

// Requests a password-reset email. The API always returns 200 (it never reveals
// whether an account exists), so this resolves on any non-network error too —
// the screen shows the same neutral confirmation regardless.
async function requestPasswordReset(email: string): Promise<void> {
  await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  // Stable across the app's lifetime: the transport reads the current tokens
  // from the store per request, so the same client works before and after
  // sign-in. onAuthFailure (a failed refresh) flips the session to signed-out.
  const signOutLocal = useRef(() => {
    setStatus('signedOut');
    setUserId(null);
    setUser(null);
    setEmailVerified(null);
    setWorkspaceId(null);
    setWorkspaces([]);
  });
  const client = useMemo<ApiClient>(
    () =>
      makeApiClient(
        makeMobileTransport({
          baseUrl: API_BASE_URL,
          tokenStore: secureTokenStore,
          onAuthFailure: () => signOutLocal.current(),
          acceptLanguage: resolveDeviceLocale(),
        }),
      ),
    [],
  );

  // Resolve the signed-in identity + active workspace from a valid access token.
  // /auth/me is the authority on identity and verification; the workspace list
  // may be empty for a freshly signed-up account that hasn't connected Gmail.
  const bootstrap = useCallback(
    async (accessToken: string) => {
      const id = readUserIdFromAccessToken(accessToken);
      setUserId(id);
      const [me, list] = await Promise.all([
        client.me().catch(() => null),
        client.workspaces().catch(() => []),
      ]);
      setWorkspaces(list);
      setUser(me ? { email: me.email, name: me.name } : findUser(list, id));
      setEmailVerified(me ? me.emailVerified : null);
      setWorkspaceId(list[0]?.id ?? null);
      setStatus('signedIn');
    },
    [client],
  );

  // Persisted per-session only (in memory): switching is a view concern, the API
  // is queried per workspace id. Guards against ids the user no longer belongs to.
  const switchWorkspace = useCallback(
    (id: string) => {
      setWorkspaceId((current) =>
        workspaces.some((ws) => ws.id === id) ? id : current,
      );
    },
    [workspaces],
  );

  const refreshWorkspaces = useCallback(async (switchToId?: string) => {
    const list = await client.workspaces().catch(() => null);
    if (!list) return;
    setWorkspaces(list);
    setUser(findUser(list, userId));
    setWorkspaceId((current) => {
      // If a specific id was requested (e.g. just-created workspace) and it
      // is in the fresh list, switch to it atomically in the same state update.
      if (switchToId && list.some((ws) => ws.id === switchToId)) return switchToId;
      // If the active workspace was deleted, fall back to the first remaining one.
      return list.some((ws) => ws.id === current) ? current : (list[0]?.id ?? null);
    });
  }, [client, userId]);

  const bumpDataVersion = useCallback(() => setDataVersion((v) => v + 1), []);

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

  // After a Stripe Checkout browser detour, confirm the session on return so the
  // upgrade / new workspace lands immediately, independent of the Stripe webhook.
  // Runs on sign-in and whenever the app foregrounds.
  const refreshWorkspacesRef = useRef(refreshWorkspaces);
  refreshWorkspacesRef.current = refreshWorkspaces;
  useEffect(() => {
    if (status !== 'signedIn') return;
    let running = false;
    const confirmPending = async () => {
      if (running) return;
      running = true;
      try {
        const sessionId = await getPendingCheckout();
        if (!sessionId) return;
        const res = await confirmCheckout(sessionId);
        if (res.ok && res.data.provisioned) {
          await clearPendingCheckout();
          // Switch to the purchased workspace so the new/upgraded one lands
          // active, rather than staying on the previously selected workspace.
          await refreshWorkspacesRef.current(res.data.workspaceId);
        } else if (res.ok && res.data.pending) {
          // Payment not finished yet — keep it for the next foreground.
        } else {
          // Terminal (invalid / forbidden) — stop retrying.
          await clearPendingCheckout();
        }
      } catch {
        // Network error — leave it pending for the next foreground.
      } finally {
        running = false;
      }
    };
    void confirmPending();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void confirmPending();
    });
    return () => sub.remove();
  }, [status]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await login(email, password);
      await secureTokenStore.set(tokens);
      await bootstrap(tokens.accessToken);
    },
    [bootstrap],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      const tokens = await register(email, password);
      await secureTokenStore.set(tokens);
      await bootstrap(tokens.accessToken);
    },
    [bootstrap],
  );

  const signInWithGoogle = useCallback(async () => {
    const authResult = await requestGoogleAuth(); // throws 'cancelled' on dismiss
    const res = await fetch(`${API_BASE_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authResult),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Google sign-in failed. Please try again.');
    }
    const tokens = (await res.json()) as StoredTokens;
    await secureTokenStore.set(tokens);
    await bootstrap(tokens.accessToken);
  }, [bootstrap]);

  // Re-resolve from the stored token without re-authenticating. No-op when
  // signed out. The verify-email screen polls this to detect verification.
  const refresh = useCallback(async () => {
    const tokens = await secureTokenStore.get();
    if (tokens) await bootstrap(tokens.accessToken);
  }, [bootstrap]);

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

  // The active workspace drives the language (UI + taxonomy). null when no
  // workspace is selected yet, so SessionLocaleProvider falls back to device locale.
  const locale = workspaces.find((ws) => ws.id === workspaceId)?.locale ?? null;

  const value = useMemo<SessionValue>(
    () => ({
      status,
      userId,
      user,
      emailVerified,
      locale,
      workspaceId,
      workspaces,
      dataVersion,
      switchWorkspace,
      refreshWorkspaces,
      bumpDataVersion,
      client,
      signIn,
      signUp,
      requestPasswordReset,
      signInWithGoogle,
      refresh,
      signOut,
    }),
    [
      status,
      userId,
      user,
      emailVerified,
      locale,
      workspaceId,
      workspaces,
      dataVersion,
      switchWorkspace,
      refreshWorkspaces,
      bumpDataVersion,
      client,
      signIn,
      signUp,
      signInWithGoogle,
      refresh,
      signOut,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
