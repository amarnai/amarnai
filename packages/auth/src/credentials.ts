import bcrypt from "bcryptjs";
import { db } from "@amarnai/db";

// Precomputed once at module load. Unknown accounts are compared against this so
// a missing user takes the same time as a wrong password, closing the login
// user-enumeration timing channel.
const DUMMY_HASH = bcrypt.hashSync("invalid-placeholder-password", 10);

// Verifies an email + password against stored credentials. Returns the user id
// on success, or null on any failure: unknown user, a Google-only account with
// no password set, or a wrong password. Shared by the web (next-auth Credentials
// provider) and the API login endpoint so the check lives in exactly one place.
export async function verifyCredentials(
  email: string,
  password: string
): Promise<string | null> {
  // Single round-trip: fetch the user and credential together via the relation.
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, credential: { select: { passwordHash: true } } },
  });

  // Always run one bcrypt comparison, even when there is no account, so response
  // timing does not reveal whether the email is registered.
  if (!user?.credential) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const matches = await bcrypt.compare(password, user.credential.passwordHash);
  return matches ? user.id : null;
}
