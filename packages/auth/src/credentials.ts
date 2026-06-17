import bcrypt from "bcryptjs";
import { db } from "@amarnai/db";

// Verifies an email + password against stored credentials. Returns the user id
// on success, or null on any failure: unknown user, a Google-only account with
// no password set, or a wrong password. Shared by the web (next-auth Credentials
// provider) and the API login endpoint so the check lives in exactly one place.
export async function verifyCredentials(
  email: string,
  password: string
): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) return null;

  const cred = await db.userCredential.findUnique({ where: { userId: user.id } });
  if (!cred) return null;

  const valid = await bcrypt.compare(password, cred.passwordHash);
  return valid ? user.id : null;
}
