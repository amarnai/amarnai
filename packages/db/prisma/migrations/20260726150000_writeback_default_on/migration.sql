-- Label writeback becomes on-by-default (product decision: the write scope is
-- granted upfront at connect; the setting is inert without it, so defaulting on
-- is safe). Existing rows are flipped too: the feature shipped in the previous
-- migration in this same release, so no user has deliberately opted out yet.
ALTER TABLE "GmailSyncSettings" ALTER COLUMN "labelWritebackEnabled" SET DEFAULT true;
UPDATE "GmailSyncSettings" SET "labelWritebackEnabled" = true;
