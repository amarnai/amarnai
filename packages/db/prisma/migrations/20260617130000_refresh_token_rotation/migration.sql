-- AlterTable: add rotation lineage (familyId) and single-use marker (usedAt).
ALTER TABLE "RefreshToken" ADD COLUMN "usedAt" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT;

-- Backfill existing rows so each becomes its own family before NOT NULL.
UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;

ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
