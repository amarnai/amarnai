-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lifecycleEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "lifecycleEmailsEnabled" BOOLEAN NOT NULL DEFAULT true;
