-- Generalize the Gmail-only connection model into a provider-neutral
-- EmailConnection so a second read-only provider (Outlook) can reuse it.
-- Pure rename + additive column: existing rows are preserved and stamped GMAIL.

-- 1. Provider enum gains OUTLOOK. (Not used in this migration, so it is safe to
--    add alongside the other statements.)
ALTER TYPE "Provider" ADD VALUE IF NOT EXISTS 'OUTLOOK';

-- 2. Connection status enum is provider-neutral.
ALTER TYPE "GmailConnectionStatus" RENAME TO "ConnectionStatus";

-- 3. Rename the table and its constraints/indexes to the neutral name so Prisma's
--    expected object names match.
ALTER TABLE "GmailConnection" RENAME TO "EmailConnection";
ALTER TABLE "EmailConnection" RENAME CONSTRAINT "GmailConnection_pkey" TO "EmailConnection_pkey";
ALTER TABLE "EmailConnection" RENAME CONSTRAINT "GmailConnection_workspaceId_fkey" TO "EmailConnection_workspaceId_fkey";
ALTER INDEX "GmailConnection_workspaceId_key" RENAME TO "EmailConnection_workspaceId_key";

-- 4. Rename the Gmail-specific columns to provider-neutral names.
ALTER TABLE "EmailConnection" RENAME COLUMN "googleSubjectId" TO "subjectId";
ALTER TABLE "EmailConnection" RENAME COLUMN "gmailAddress" TO "emailAddress";
ALTER TABLE "EmailConnection" RENAME COLUMN "gmailWatchExpiresAt" TO "watchExpiresAt";

-- 5. Add the provider discriminant; every existing row is a Gmail connection.
ALTER TABLE "EmailConnection" ADD COLUMN "provider" "Provider" NOT NULL DEFAULT 'GMAIL';
