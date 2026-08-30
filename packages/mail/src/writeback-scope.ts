import { hasWritebackScope as gmailHasWriteback } from "@aziru/gmail";
import { hasWritebackScope as outlookHasWriteback } from "@aziru/outlook";

/**
 * Whether a connection's granted scopes include the provider's write scope
 * (gmail.modify / Mail.ReadWrite) needed for label/category writeback. Dispatches
 * to the per-provider check so the scope strings stay single-sourced in each
 * provider package. Callers that already depend on both provider packages (the
 * web build does not) should prefer this over re-implementing the dispatch.
 */
export function providerHasWritebackScope(
  provider: "GMAIL" | "OUTLOOK",
  grantedScopes: readonly string[],
): boolean {
  return provider === "OUTLOOK"
    ? outlookHasWriteback(grantedScopes)
    : gmailHasWriteback(grantedScopes);
}
