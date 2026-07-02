// Reads the `sub` (user id) claim from an access token without verifying it.
//
// The API is the only authority on token validity; the client just needs the
// user id for the api-client methods that take it explicitly (markThreadDone,
// etc.). Dependency-free base64url decode (no reliance on a global atob) so it
// behaves identically in the panel, tests, and any worker context.
export function readUserIdFromAccessToken(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const sub = payload?.["sub"];
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = base64UrlDecode(parts[1]!);
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of b64) {
    if (ch === "=") break;
    const idx = B64_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

function utf8Decode(bytes: number[]): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = bytes[i++]! & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i++]! & 0x3f;
      const b2 = bytes[i++]! & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else {
      const b1 = bytes[i++]! & 0x3f;
      const b2 = bytes[i++]! & 0x3f;
      const b3 = bytes[i++]! & 0x3f;
      const cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}
