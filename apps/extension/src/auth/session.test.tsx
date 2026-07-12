import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider, useSession } from "./session";
import { resetChromeStorage } from "../test-setup";

// bootstrap() restores a stored session on launch. The invariant under test:
// "signedIn" is asserted ONLY when /auth/me actually succeeds. A failed me() must
// route by cause, not collapse to a single state:
//   - expired/revoked refresh token (tokens cleared by the transport) -> signedOut
//   - transient network error (tokens still present)                  -> error
// The regression this guards: bootstrap used to setStatus("signedIn")
// unconditionally, clobbering the sign-out the transport had just triggered and
// stranding an expired user on the "Connect Gmail" screen instead of sign-in.

const TOKEN_KEY = "amarnai.auth.tokens";

// A JWT is decoded (not verified) to read `sub` as the user id. Only the payload
// segment matters; the signature is a placeholder.
function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(sub: string): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub })}.sig`;
}

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
function res(status: number, body: unknown): Res {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Per-test fetch behaviour, keyed on the request path.
let handler: (url: string) => Promise<Res>;

async function storedTokens(): Promise<unknown> {
  const out = await chrome.storage.local.get(TOKEN_KEY);
  const raw = (out as Record<string, string | undefined>)[TOKEN_KEY];
  return raw ? JSON.parse(raw) : null;
}

const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider>{children}</SessionProvider>;

describe("SessionProvider bootstrap", () => {
  beforeEach(async () => {
    resetChromeStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => handler(String(url))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedTokens(): Promise<void> {
    await chrome.storage.local.set({
      [TOKEN_KEY]: JSON.stringify({
        accessToken: makeJwt("user-1"),
        refreshToken: "ref-1",
        refreshTokenExpiresAt: "2999-01-01T00:00:00.000Z",
      }),
    });
  }

  it("routes an expired/revoked session to signedOut and clears the tokens", async () => {
    await seedTokens();
    // Every authed call 401s and the refresh itself 401s (expired refresh token).
    handler = async () => res(401, { error: "unauthorized" });

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("signedOut"));
    // The transport must have cleared the dead tokens; the user is fully signed out.
    expect(await storedTokens()).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it("keeps a valid session with no workspace on signedIn (Connect-Gmail is valid here)", async () => {
    await seedTokens();
    handler = async (url) => {
      if (url.includes("/auth/me")) {
        return res(200, {
          userId: "user-1",
          email: "a@b.com",
          name: "Ada",
          emailVerified: true,
          lifecycleEmailsEnabled: true,
          hasPassword: true,
        });
      }
      if (url.includes("/workspaces")) return res(200, []); // account not yet connected
      return res(404, {});
    };

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("signedIn"));
    expect(result.current.userId).toBe("user-1");
    expect(result.current.workspaceId).toBeNull(); // -> App renders <NoWorkspace/>, the correct screen
    expect(await storedTokens()).not.toBeNull();
  });

  it("routes a transient network failure to error without discarding valid tokens", async () => {
    await seedTokens();
    // No 401 -> no refresh attempted; the request itself fails (server unreachable).
    handler = async () => {
      throw new TypeError("Failed to fetch");
    };

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
    // The session may still be valid once connectivity returns: tokens are kept.
    expect(await storedTokens()).not.toBeNull();
  });

  it("routes a launch with no stored tokens straight to signedOut", async () => {
    handler = async () => res(401, {});

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("signedOut"));
  });
});
