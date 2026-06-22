-- CreateEnum
CREATE TYPE "GmailOAuthClient" AS ENUM ('WEB', 'MOBILE');

-- AlterTable
ALTER TABLE "GmailConnection" ADD COLUMN     "oauthClient" "GmailOAuthClient" NOT NULL DEFAULT 'WEB';
