import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { issueAccessToken, verifyAccessToken } from "./jwt.js";

// Mirrors the dev fallback in @aziru/config (no AUTH_JWT_SECRET in tests).
const SECRET = new TextEncoder().encode("dev-auth-jwt-secret");

describe("access tokens", () => {
  it("round-trips: a freshly issued token verifies to its user id and epoch", async () => {
    const token = await issueAccessToken("user-123", 5);
    expect(await verifyAccessToken(token)).toEqual({ userId: "user-123", sessionEpoch: 5 });
  });

  it("rejects a malformed/garbage token", async () => {
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
  });

  it("rejects a token with no epoch claim (pre-epoch token)", async () => {
    const noEpoch = await new SignJWT({ typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuer("amarnai")
      .setAudience("amarnai-api")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(SECRET);
    expect(await verifyAccessToken(noEpoch)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const foreign = await new SignJWT({ typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("some-other-secret"));
    expect(await verifyAccessToken(foreign)).toBeNull();
  });

  it("rejects a token without the access type claim", async () => {
    const wrongType = await new SignJWT({ typ: "refresh" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuer("amarnai")
      .setAudience("amarnai-api")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(SECRET);
    expect(await verifyAccessToken(wrongType)).toBeNull();
  });

  it("rejects a token with the wrong audience", async () => {
    const wrongAud = await new SignJWT({ typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuer("amarnai")
      .setAudience("some-other-service")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(SECRET);
    expect(await verifyAccessToken(wrongAud)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-123")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(SECRET);
    expect(await verifyAccessToken(expired)).toBeNull();
  });
});
