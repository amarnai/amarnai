import { GmailClient } from "@amarnai/gmail";
import type { MailProvider } from "./types.js";

/**
 * The minimal shape {@link createMailProvider} needs off a stored connection
 * row. Structurally matches an `EmailConnection` (Prisma), so callers pass the
 * row directly after loading it.
 */
export type MailConnection = {
  provider: "GMAIL" | "OUTLOOK";
  encryptedRefreshToken: string;
};

// Compile-time guarantee that GmailClient satisfies the MailProvider contract.
// If a method drifts, this line fails to typecheck (structural conformance —
// GmailClient does not import this package, avoiding a dependency cycle).
const _gmailConformsToMailProvider: new (encryptedRefreshToken: string) => MailProvider =
  GmailClient;
void _gmailConformsToMailProvider;

/**
 * Selects the mail adapter for a connection. Mirrors `createAIProvider`
 * (packages/ai): a `switch` on the discriminant returning the concrete
 * implementation. Selection is per-connection, not a global env switch — a
 * workspace may have Gmail or (later) Outlook connected.
 */
export function createMailProvider(connection: MailConnection): MailProvider {
  switch (connection.provider) {
    case "GMAIL":
      return new GmailClient(connection.encryptedRefreshToken);
    case "OUTLOOK":
      throw new Error(
        "Outlook provider is not yet implemented (Phase B). Connect a Gmail account.",
      );
  }
}
