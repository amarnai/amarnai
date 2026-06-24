-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]';
