-- AlterTable
ALTER TABLE "EmailThread" ADD COLUMN     "classifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "classifyFailedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_triageStatus_classifyFailedAt_idx" ON "EmailThread"("workspaceId", "triageStatus", "classifyFailedAt");
