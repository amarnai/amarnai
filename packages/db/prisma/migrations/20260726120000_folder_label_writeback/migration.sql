-- Opt-in folder→label writeback (Gmail labels / Outlook categories). Additive
-- and default-off, so no backfill and no impact on existing read-only workspaces.

-- Per-workspace opt-in toggle. Defaults false; enabling requires the write scope.
ALTER TABLE "GmailSyncSettings" ADD COLUMN "labelWritebackEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Maps a taxonomy node to its provider-side identifier (Gmail label id / Outlook
-- category displayName), keyed to the connected mailbox so inbox rotation is
-- self-healing. One row per (node, provider).
CREATE TABLE "TaxonomyNodeProviderLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "mailboxKey" TEXT NOT NULL,
    "providerLabelId" TEXT NOT NULL,
    "providerPath" TEXT NOT NULL,
    "provisionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyNodeProviderLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxonomyNodeProviderLink_nodeId_provider_key" ON "TaxonomyNodeProviderLink"("nodeId", "provider");

CREATE INDEX "TaxonomyNodeProviderLink_workspaceId_provider_idx" ON "TaxonomyNodeProviderLink"("workspaceId", "provider");

ALTER TABLE "TaxonomyNodeProviderLink" ADD CONSTRAINT "TaxonomyNodeProviderLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaxonomyNodeProviderLink" ADD CONSTRAINT "TaxonomyNodeProviderLink_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
