-- Retire any Android-public-client connections: their refresh tokens are not
-- server-refreshable, so they cannot sync. Force a clean reconnect.
UPDATE "GmailConnection" SET "status" = 'DISCONNECTED' WHERE "oauthClient" = 'MOBILE';

-- DropColumn: all refresh tokens are now minted against the confidential Web
-- client (server-refreshable), so the per-connection client is vestigial.
ALTER TABLE "GmailConnection" DROP COLUMN "oauthClient";

-- DropEnum
DROP TYPE "GmailOAuthClient";
