import { upsertEmailConnection } from "@amarnai/auth";
import type { MailProvider } from "@/lib/api";

type PersistConnectionInput = {
  workspaceId: string;
  provider: MailProvider;
  // Stable provider subject id (Outlook Entra object id). Null for Gmail, which
  // exposes no stable id for gmail.readonly-only access.
  subjectId: string | null;
  emailAddress: string;
  encryptedRefreshToken: string;
  grantedScopes: string[];
};

/**
 * Persist the workspace's single EmailConnection from an OAuth callback.
 *
 * Unlike storeGmailConnection / storeOutlookConnection, this path does NOT run
 * the cross-provider guard: the web connect callbacks are the deliberate
 * provider-switch surface (behind the "this erases the other inbox"
 * confirmation), so connecting Gmail here may replace an Outlook connection and
 * vice versa. It shares the same upsertEmailConnection primitive, so the set of
 * provider-scoped fields reset on a switch stays identical across every connect
 * path and cannot inherit stale state from a prior provider.
 */
export async function persistEmailConnection(
  input: PersistConnectionInput,
): Promise<void> {
  await upsertEmailConnection(input);
}
