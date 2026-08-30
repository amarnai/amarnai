import { SignJWT, jwtVerify } from "jose";
import { config } from "@aziru/config";

// Short-lived access tokens. Native clients refresh silently via a rotating
// refresh token (see refresh-token.ts) so this can stay tight.
const ACCESS_TOKEN_TTL = "15m";

// Bind tokens to this issuer/audience so a token minted for a different service
// (or a future second consumer) cannot be replayed against this API.
const ISSUER = "amarnai";
const AUDIENCE = "amarnai-api";

const key = new TextEncoder().encode(config.authJwtSecret);

export type VerifiedAccessToken = { userId: string; sessionEpoch: number };

// Issues a per-user access token. The user id is carried in the standard `sub`
// claim; the API derives the authenticated user from it instead of trusting a
// caller-supplied header. The account's session epoch at issue time is stamped in
// `epoch` so the API can reject the token once that epoch advances (password
// reset / pre-hijack invalidation), rather than trusting it for the full TTL.
export async function issueAccessToken(userId: string, sessionEpoch: number): Promise<string> {
  return new SignJWT({ typ: "access", epoch: sessionEpoch })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(key);
}

// Verifies an access token. Returns the user id and the session epoch it was
// minted at, or null if the token is missing, malformed, expired, wrong
// type/issuer/audience, signed with a different secret, or carries no numeric
// `epoch` claim (a pre-epoch token — never trusted; the caller silently refreshes
// into an epoch-stamped one). The caller compares the returned epoch against the
// account's current epoch to complete the revocation check.
export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload["typ"] !== "access") return null;
    const epoch = payload["epoch"];
    if (typeof payload.sub !== "string" || typeof epoch !== "number") return null;
    return { userId: payload.sub, sessionEpoch: epoch };
  } catch {
    return null;
  }
}
