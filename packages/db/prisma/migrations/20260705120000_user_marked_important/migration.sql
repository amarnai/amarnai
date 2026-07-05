-- Replace the Gmail-derived important flag with a user-marked "important" star.
-- Existing Gmail-derived values are intentionally dropped (start fresh): the new
-- column is set by the Amarnai UI, not by Gmail sync.
ALTER TABLE "EmailThread" DROP COLUMN "gmailIsImportant";
ALTER TABLE "EmailThread" ADD COLUMN "isImportant" BOOLEAN NOT NULL DEFAULT false;

-- The one-time Gmail-important backfill no longer runs.
ALTER TABLE "ProviderSyncState" DROP COLUMN "importantBackfilled";
