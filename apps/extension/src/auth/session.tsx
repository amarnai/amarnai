import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { makeApiClient, makeBearerTransport, type ApiClient, type Workspace } from "@amarnai/api-client";
import { API_BASE_URL } from "../config";
import { readUserIdFromAccessToken } from "./jwt";
import { extensionTokenStore, type StoredTokens } from "./tokenStore";
import { requestGoogleAuth } from "./googleAuth";

type Status = "loading" | "signedOut" | "signedIn";

type SessionUser = { email: string; name: string | null };

// Resolve the signed-in user's profile from any workspace they belong to. Used
// as a fallback when /auth/me fails but the workspace list resolved.
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
  emailVerified: boolean | null;
  // Active workspace's language; null until the workspace list resolves.
  locale: string | null;
  workspaceId: string | null;
  workspaces: Workspace[];
  client: ApiClient;
  switchWorkspace(id: string): void;
  refreshWorkspaces(switchToId?: string): Promise<void>;
  // Throws on invalid credentials so the sign-in screen can show the error.
  signIn(email: string, password: string): Promise<void>;
  // Runs the Google OAuth flow and provisions/signs in via /auth/google. Throws
  // GoogleAuthCancelledError on dismiss, and a user-facing message otherwise.
  signInWithGoogle(): Promise<void>;
  // Re-runs the Gmail OAuth grant and reconnects the given workspace (not the
  // default one), reactivating a DISCONNECTED connection. Unlike signInWithGoogle
  // it leaves the session tokens untouched — the user is already signed in.
  // Throws GoogleAuthCancelledError on dismiss.
  reconnectGmail(targetWorkspaceId: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function login(email: string, password: string): Promise<StoredTokens> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) return (await res.json()) as StoredTokens;
  if (res.status === 401) throw new Error("Invalid email or password");
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? "Sign-in failed. Please try again.");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Stable across the panel's lifetime: the transport reads the current tokens
  // from chrome.storage per request, so the same client works before and after
  // sign-in. onAuthFailure (a failed refresh) flips the session to signed-out.
  const signOutLocal = useRef(() => {
    setStatus("signedOut");
    setUserId(null);
    setUser(null);
    setEmailVerified(null);
    setWorkspaceId(null);
    setWorkspaces([]);
  });
  const client = useMemo<ApiClient>(
    () =>
      makeApiClient(
        makeBearerTransport({
          baseUrl: API_BASE_URL,
          tokenStore: extensionTokenStore,
          onAuthFailure: () => signOutLocal.current(),
          acceptLanguage: navigator.language,
        }),
      ),
    [],
  );

  // Resolve identity + active workspace from a valid access token. /auth/me is
  // the authority on identity + verification; the workspace list may be empty
  // for an account that has not connected Gmail yet.
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
      setStatus("signedIn");
    },
    [client],
  );

  const switchWorkspace = useCallback(
    (id: string) => {
      setWorkspaceId((current) => (workspaces.some((ws) => ws.id === id) ? id : current));
    },
    [workspaces],
  );

  const refreshWorkspaces = useCallback(
    async (switchToId?: string) => {
      const list = await client.workspaces().catch(() => null);
      if (!list) return;
      setWorkspaces(list);
      setUser(findUser(list, userId));
      setWorkspaceId((current) => {
        if (switchToId && list.some((ws) => ws.id === switchToId)) return switchToId;
        return list.some((ws) => ws.id === current) ? current : (list[0]?.id ?? null);
      });
    },
    [client, userId],
  );

  // On launch, restore any stored session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await extensionTokenStore.get();
      if (cancelled) return;
      if (!tokens) {
        setStatus("signedOut");
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
      await extensionTokenStore.set(tokens);
      await bootstrap(tokens.accessToken);
    },
    [bootstrap],
  );

  const signInWithGoogle = useCallback(async () => {
    const authResult = await requestGoogleAuth(); // throws GoogleAuthCancelledError on dismiss
    const res = await fetch(`${API_BASE_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authResult),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Google sign-in failed. Please try again.");
    }
    const tokens = (await res.json()) as StoredTokens;
    await extensionTokenStore.set(tokens);
    await bootstrap(tokens.accessToken);
  }, [bootstrap]);

  const reconnectGmail = useCallback(
    async (targetWorkspaceId: string) => {
      const authResult = await requestGoogleAuth(); // throws GoogleAuthCancelledError on dismiss
      // Reconnect THIS workspace via the workspace-scoped endpoint. /auth/google
      // cannot be used here: it always targets the user's oldest-owned workspace
      // (getOrCreateDefaultWorkspace), so it would reactivate the wrong workspace
      // and leave the viewed one DISCONNECTED. connectGmail redeems the extension's
      // chromiumapp.org code via the redirectUri branch (mirrors /auth/google).
      // Leaves the session tokens untouched — we're already signed in.
      await client.connectGmail(targetWorkspaceId, authResult);
      // Refresh workspaces to pick up the now-ACTIVE connection, staying on the
      // workspace the user was viewing.
      await refreshWorkspaces(targetWorkspaceId);
    },
    [client, refreshWorkspaces],
  );

  const signOut = useCallback(async () => {
    const tokens = await extensionTokenStore.get();
    if (tokens?.refreshToken) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => {});
    }
    await extensionTokenStore.clear();
    signOutLocal.current();
  }, []);

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
      client,
      switchWorkspace,
      refreshWorkspaces,
      signIn,
      signInWithGoogle,
      reconnectGmail,
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
      client,
      switchWorkspace,
      refreshWorkspaces,
      signIn,
      signInWithGoogle,
      reconnectGmail,
      signOut,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
