import { GmailClient } from "@amarnai/gmail";
import { GraphClient } from "@amarnai/outlook";
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

// Compile-time guarantee that each adapter satisfies the MailProvider contract.
// If a method drifts, these lines fail to typecheck (structural conformance —
// the adapters do not import this package, avoiding a dependency cycle).
const _gmailConformsToMailProvider: new (encryptedRefreshToken: string) => MailProvider =
  GmailClient;
const _graphConformsToMailProvider: new (encryptedRefreshToken: string) => MailProvider =
  GraphClient;
void _gmailConformsToMailProvider;
void _graphConformsToMailProvider;

/**
 * Selects the mail adapter for a connection. Mirrors `createAIProvider`
 * (packages/ai): a `switch` on the discriminant returning the concrete
 * implementation. Selection is per-connection, not a global env switch — a
 * workspace may have Gmail or Outlook connected.
 */
export function createMailProvider(connection: MailConnection): MailProvider {
  switch (connection.provider) {
    case "GMAIL":
      return new GmailClient(connection.encryptedRefreshToken);
    case "OUTLOOK":
      return new GraphClient(connection.encryptedRefreshToken);
  }
}
