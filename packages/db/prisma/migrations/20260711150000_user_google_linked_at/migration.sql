-- Add the Google-linkage marker.
ALTER TABLE "User" ADD COLUMN "googleLinkedAt" TIMESTAMP(3);

-- Backfill: reproduce the previous "verified account with no password credential
-- is a Google account" inference, so recovery guidance for every pre-existing
-- account is unchanged after the cutover. New sign-ins set this precisely in
-- provisionGoogleUser. We deliberately do NOT mark verified accounts that hold a
-- password (they may or may not also use Google, but they are recoverable via
-- their password either way).
UPDATE "User" u
SET "googleLinkedAt" = COALESCE(u."emailVerified", u."createdAt")
WHERE u."emailVerified" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "UserCredential" c WHERE c."userId" = u."id"
  );
