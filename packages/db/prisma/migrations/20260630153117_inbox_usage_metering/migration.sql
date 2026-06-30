-- CreateEnum
CREATE TYPE "MeterKind" AS ENUM ('THREAD_SORT', 'DRAFT', 'TAXONOMY_GEN', 'BACKFILL');

-- CreateTable
CREATE TABLE "InboxUsageMeter" (
    "id" TEXT NOT NULL,
    "inboxKey" TEXT NOT NULL,
    "kind" "MeterKind" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "graceUsed" BOOLEAN NOT NULL DEFAULT false,
    "sizedForPlan" "WorkspacePlan",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxUsageMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxBackfillGrant" (
    "id" TEXT NOT NULL,
    "inboxKey" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "freeConsumed" INTEGER NOT NULL DEFAULT 0,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxBackfillGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxUsageMeter_inboxKey_kind_idx" ON "InboxUsageMeter"("inboxKey", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "InboxUsageMeter_inboxKey_kind_windowStart_key" ON "InboxUsageMeter"("inboxKey", "kind", "windowStart");

-- CreateIndex
CREATE INDEX "InboxBackfillGrant_inboxKey_idx" ON "InboxBackfillGrant"("inboxKey");

-- CreateIndex
CREATE UNIQUE INDEX "InboxBackfillGrant_inboxKey_workspaceId_key" ON "InboxBackfillGrant"("inboxKey", "workspaceId");
