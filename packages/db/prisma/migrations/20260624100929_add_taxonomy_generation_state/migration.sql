-- CreateEnum
CREATE TYPE "TaxonomyGenerationStatus" AS ENUM ('IDLE', 'RUNNING', 'READY', 'INSUFFICIENT', 'FAILED');

-- CreateTable
CREATE TABLE "TaxonomyGenerationState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "TaxonomyGenerationStatus" NOT NULL DEFAULT 'IDLE',
    "proposal" JSONB,
    "matchedTemplateId" TEXT,
    "lastGeneratedAt" TIMESTAMP(3),
    "threadCountAtLastGen" INTEGER,
    "lastOutcome" TEXT,
    "generationsWindowStart" TIMESTAMP(3),
    "generationsInWindow" INTEGER NOT NULL DEFAULT 0,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyGenerationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyGenerationState_workspaceId_key" ON "TaxonomyGenerationState"("workspaceId");

-- AddForeignKey
ALTER TABLE "TaxonomyGenerationState" ADD CONSTRAINT "TaxonomyGenerationState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
