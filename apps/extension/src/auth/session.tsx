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
import {
  makeApiClient,
  makeBearerTransport,
  readUserIdFromAccessToken,
  type ApiClient,
  type Workspace,
} from "@aziru/api-client";
import { API_BASE_URL } from "../config";
import { extensionTokenStore, type StoredTokens } from "./tokenStore";
import { requestGoogleAuth } from "./googleAuth";
import { requestMicrosoftAuth } from "./microsoftAuth";

// "error" means the stored session looks valid (tokens are still present) but the
// server was unreachable during startup, so identity could not be confirmed. It is
// deliberately distinct from "signedOut": we must not discard a possibly-valid
// session over a transient network failure.
type Status = "loading" | "signedOut" | "signedIn" | "error";

type SessionUser = { email: string; name: string | null };

// Resolve the signed-in user's profile from any workspace they belong to. Used
// by refreshWorkspaces to re-derive the profile from a refreshed workspace list
// without a second /auth/me round-trip.
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
  // Re-attempts session restore from the stored tokens. Used by the "error"
  // (couldn't-reach-server) screen so the user can retry without re-signing-in.
  retry(): Promise<void>;
  // True once, for the caller that asks first, after a sign-in or mailbox
  // connect the user actually performed in this panel. Lets the triage view tell
  // "the user just connected" from "the panel was reopened", which look
  // identical from the loaded data alone. See revealMailbox.
  consumeJustConnected(): boolean;
  // Throws on invalid credentials so the sign-in screen can show the error.
  signIn(email: string, password: string): Promise<void>;
  // Runs the Google OAuth flow and provisions/signs in via /auth/google. Throws
  // GoogleAuthCancelledError on dismiss, and a user-facing message otherwise.
  signInWithGoogle(): Promise<void>;
  // Microsoft counterpart of signInWithGoogle: runs the Microsoft OAuth flow and
  // provisions/signs in via /auth/microsoft. Throws MicrosoftAuthCancelledError
  // on dismiss, and a user-facing message otherwise.
  signInWithMicrosoft(): Promise<void>;
  // Re-runs the Gmail OAuth grant and reconnects the given workspace (not the
  // default one), reactivating a DISCONNECTED connection. Unlike signInWithGoogle
  // it leaves the session tokens untouched — the user is already signed in.
  // Throws GoogleAuthCancelledError on dismiss.
  reconnectGmail(targetWorkspaceId: string): Promise<void>;
  // Outlook counterpart of reconnectGmail: runs the Microsoft OAuth grant and
  // reconnects the given workspace's Outlook inbox. Leaves the session untouched.
  // Throws MicrosoftAuthCancelledError on dismiss.
  reconnectOutlook(targetWorkspaceId: string): Promise<void>;
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
  // Raised by every sign-in and connect the user drives from this panel, and
  // lowered by whoever reads it. A ref, not state: nothing renders from it, and
  // it must not survive the panel being closed. A stored flag would let a tab
  // move happen on a later panel open, long after the gesture that earned it.
  const justConnected = useRef(false);
  const consumeJustConnected = useCallback(() => {
    const value = justConnected.current;
    justConnected.current = false;
    return value;
  }, []);

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
  //
  // "signedIn" is gated on /auth/me actually succeeding — never asserted blindly.
  // A failed me() has two very different causes that must route differently:
  //   - Auth failure (expired/revoked refresh token): the transport clears the
  //     tokens and fires onAuthFailure, so the store is now empty -> sign the user
  //     out and route to the sign-in screen.
  //   - Transient network error: the tokens are still present and may still be
  //     valid -> do NOT sign out; surface a retry ("error") instead.
  // workspaces() is caught to null (not []) so we can tell a genuinely empty list
  // (valid: account has not connected Gmail) from a failed load.
  const bootstrap = useCallback(
    async (accessToken: string) => {
      const id = readUserIdFromAccessToken(accessToken);
      const [me, list] = await Promise.all([
        client.me().catch(() => null),
        client.workspaces().catch(() => null),
      ]);
      if (me && list) {
        setUserId(id);
        setWorkspaces(list);
        setUser({ email: me.email, name: me.name });
        setEmailVerified(me.emailVerified);
        setWorkspaceId(list[0]?.id ?? null);
        setStatus("signedIn");
        return;
      }
      // Identity or workspace load failed. Re-read the store: the transport clears
      // tokens only on a real auth failure, so their presence disambiguates.
      const tokens = await extensionTokenStore.get();
      if (!tokens) {
        // Auth failure. The transport already fired onAuthFailure -> signedOut;
        // make it explicit so bootstrap never leaves a stale "signedIn" behind.
        signOutLocal.current();
        return;
      }
      // Tokens still valid, but the server was unreachable. Keep the session and
      // let the user retry rather than falsely showing "Connect Gmail".
      setStatus("error");
    },
    [client],
  );

  // Restore a stored session (used on launch and by retry()). No tokens -> the
  // user is signed out; otherwise resolve identity via bootstrap.
  const restoreSession = useCallback(async () => {
    const tokens = await extensionTokenStore.get();
    if (!tokens) {
      setStatus("signedOut");
      return;
    }
    await bootstrap(tokens.accessToken);
  }, [bootstrap]);

  const retry = useCallback(async () => {
    setStatus("loading");
    await restoreSession();
  }, [restoreSession]);

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
    void restoreSession();
  }, [restoreSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await login(email, password);
      await extensionTokenStore.set(tokens);
      justConnected.current = true;
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
    justConnected.current = true;
    await bootstrap(tokens.accessToken);
  }, [bootstrap]);

  const signInWithMicrosoft = useCallback(async () => {
    const authResult = await requestMicrosoftAuth(); // throws MicrosoftAuthCancelledError on dismiss
    // Raw fetch, not the ApiClient: this is the pre-token call that mints the
    // session (mirrors signInWithGoogle).
    const res = await fetch(`${API_BASE_URL}/auth/microsoft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authResult),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Microsoft sign-in failed. Please try again.");
    }
    const tokens = (await res.json()) as StoredTokens;
    await extensionTokenStore.set(tokens);
    justConnected.current = true;
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
      justConnected.current = true;
      // Refresh workspaces to pick up the now-ACTIVE connection, staying on the
      // workspace the user was viewing.
      await refreshWorkspaces(targetWorkspaceId);
    },
    [client, refreshWorkspaces],
  );

  const reconnectOutlook = useCallback(
    async (targetWorkspaceId: string) => {
      const authResult = await requestMicrosoftAuth(); // throws MicrosoftAuthCancelledError on dismiss
      // Reconnect THIS workspace's Outlook inbox via the workspace-scoped
      // endpoint (mirrors reconnectGmail). Leaves the session tokens untouched —
      // we're already signed in.
      await client.connectOutlook(targetWorkspaceId, authResult);
      justConnected.current = true;
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
      retry,
      consumeJustConnected,
      signIn,
      signInWithGoogle,
      signInWithMicrosoft,
      reconnectGmail,
      reconnectOutlook,
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
      retry,
      consumeJustConnected,
      signIn,
      signInWithGoogle,
      signInWithMicrosoft,
      reconnectGmail,
      reconnectOutlook,
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
