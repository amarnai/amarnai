import crypto from "crypto";

function getKey(): Buffer {
  const hex = process.env["GMAIL_TOKEN_ENCRYPTION_KEY"] ?? "";
  if (hex.length === 64) {
    return Buffer.from(hex, "hex");
  }
  const secret = process.env["AUTH_SECRET"] ?? "amarnai-fallback";
  return crypto.createHash("sha256").update("gmail-token:" + secret).digest();
}

export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const [ivHex, tagHex, ctHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
