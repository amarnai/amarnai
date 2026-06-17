import { SignJWT, jwtVerify } from "jose";
import { config } from "@amarnai/config";

// Short-lived access tokens. Native clients refresh silently via a rotating
// refresh token (see refresh-token.ts) so this can stay tight.
const ACCESS_TOKEN_TTL = "15m";

const key = new TextEncoder().encode(config.authJwtSecret);

// Issues a per-user access token. The user id is carried in the standard `sub`
// claim; the API derives the authenticated user from it instead of trusting a
// caller-supplied header.
export async function issueAccessToken(userId: string): Promise<string> {
  return new SignJWT({ typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(key);
}

// Verifies an access token. Returns the user id on success, or null if the token
// is missing, malformed, expired, wrong type, or signed with a different secret.
export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload["typ"] !== "access") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
