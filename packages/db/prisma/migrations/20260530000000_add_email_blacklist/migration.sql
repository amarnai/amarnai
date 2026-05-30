ALTER TABLE "GmailSyncSettings" ADD COLUMN "blacklistedSenderEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
