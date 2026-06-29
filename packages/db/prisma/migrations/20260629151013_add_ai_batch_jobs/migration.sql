-- CreateEnum
CREATE TYPE "BatchJobKind" AS ENUM ('EMBED', 'LLM');

-- CreateEnum
CREATE TYPE "BatchJobStatus" AS ENUM ('SUBMITTED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BatchThreadStatus" AS ENUM ('EMBED_PENDING', 'ROUTING', 'LLM_PENDING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "TriageStatus" ADD VALUE 'BATCH_PENDING';

-- CreateTable
CREATE TABLE "AiBatchJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "kind" "BatchJobKind" NOT NULL,
    "status" "BatchJobStatus" NOT NULL DEFAULT 'SUBMITTED',
    "providerJobId" TEXT,
    "modelName" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorMessage" TEXT,
    "pollAttempts" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "polledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchThreadState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "status" "BatchThreadStatus" NOT NULL DEFAULT 'EMBED_PENDING',
    "threadVector" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "threadTextHash" TEXT,
    "bodyHash" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "llmAnswers" JSONB NOT NULL DEFAULT '{}',
    "round" INTEGER NOT NULL DEFAULT 0,
    "embedBatchId" TEXT,
    "llmBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchThreadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBatchJob_status_idx" ON "AiBatchJob"("status");

-- CreateIndex
CREATE INDEX "AiBatchJob_workspaceId_kind_status_idx" ON "AiBatchJob"("workspaceId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiBatchJob_providerJobId_key" ON "AiBatchJob"("providerJobId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchThreadState_emailThreadId_key" ON "BatchThreadState"("emailThreadId");

-- CreateIndex
CREATE INDEX "BatchThreadState_workspaceId_status_idx" ON "BatchThreadState"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "BatchThreadState_embedBatchId_idx" ON "BatchThreadState"("embedBatchId");

-- CreateIndex
CREATE INDEX "BatchThreadState_llmBatchId_idx" ON "BatchThreadState"("llmBatchId");

-- AddForeignKey
ALTER TABLE "AiBatchJob" ADD CONSTRAINT "AiBatchJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchThreadState" ADD CONSTRAINT "BatchThreadState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchThreadState" ADD CONSTRAINT "BatchThreadState_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
