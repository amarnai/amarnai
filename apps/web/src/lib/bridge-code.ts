/**
 * Server-side client for the API's bridge-code endpoints. Both are gated on the
 * internal secret, so this must only ever be called from the server. It is not
 * marked "server-only" because auth.ts imports it and that module is pulled into
 * the proxy bundle; the secret lives in a server-only env var, so a browser copy
 * would be inert rather than dangerous.
 */

export type BridgeIdentity = {
  userId: string;
  email: string;
  emailVerified: boolean;
};

async function callBridgeEndpoint(
  path: "inspect" | "redeem",
  code: string
): Promise<BridgeIdentity | null> {
  const apiUrl = process.env.API_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!apiUrl || !secret) return null;

  try {
    const res = await fetch(`${apiUrl}/auth/bridge/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<BridgeIdentity>;
    if (typeof body.userId !== "string" || typeof body.email !== "string") return null;
    return {
      userId: body.userId,
      email: body.email,
      emailVerified: body.emailVerified === true,
    };
  } catch {
    // A dead API is indistinguishable to the user from a dead code: both fall
    // back to the normal sign-in page with the destination preserved.
    return null;
  }
}

/** Who a code belongs to, without spending it. */
export function inspectBridgeCode(code: string): Promise<BridgeIdentity | null> {
  return callBridgeEndpoint("inspect", code);
}

/** Spend a code and resolve its account. Single-use: a second call fails. */
export function redeemBridgeCode(code: string): Promise<BridgeIdentity | null> {
  return callBridgeEndpoint("redeem", code);
}
