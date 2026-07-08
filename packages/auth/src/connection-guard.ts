import { db } from "@amarnai/db";

export type ConnectionProvider = "GMAIL" | "OUTLOOK";

// Thrown when a connect for one provider targets a workspace whose existing
// connection belongs to another. The connection row is unique per workspace, so
// connecting would silently clobber/reactivate the other provider's inbox (e.g.
// a returning Outlook user signing into the extension with Google reactivating
// their disconnected Outlook inbox).
export class ProviderMismatchError extends Error {
  constructor(
    public readonly existingProvider: string,
    public readonly attemptedProvider: ConnectionProvider,
  ) {
    super(
      `Workspace connection uses provider ${existingProvider}; cannot connect ${attemptedProvider}`,
    );
    this.name = "ProviderMismatchError";
  }
}

// Refuse to connect `provider` when the workspace already holds a connection for
// a different provider. Deliberate provider switches go through the web connect
// callbacks (persistEmailConnection), which reset every provider-scoped field
// behind an explicit "this erases the other inbox" confirmation.
export async function assertNoProviderConflict(
  workspaceId: string,
  provider: ConnectionProvider,
): Promise<void> {
  const existing = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { provider: true },
  });
  if (existing && existing.provider !== provider) {
    throw new ProviderMismatchError(existing.provider, provider);
  }
}
