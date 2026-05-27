-- AlterTable: add Gmail category flags to EmailThread
-- Defaults to false for all existing rows (treated as "unknown, show by default").
-- Flags are updated to their correct values the next time each thread is synced.
ALTER TABLE "EmailThread" ADD COLUMN "gmailIsSpam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailThread" ADD COLUMN "gmailIsPromotions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailThread" ADD COLUMN "gmailIsTrash" BOOLEAN NOT NULL DEFAULT false;
