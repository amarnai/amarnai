-- CreateTable
CREATE TABLE "TaxonomyNodeReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "embeddingVector" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embeddingModel" TEXT,
    "embeddingTextHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyNodeReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyNodeReference_emailThreadId_key" ON "TaxonomyNodeReference"("emailThreadId");

-- CreateIndex
CREATE INDEX "TaxonomyNodeReference_workspaceId_nodeId_updatedAt_idx" ON "TaxonomyNodeReference"("workspaceId", "nodeId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TaxonomyNodeReference" ADD CONSTRAINT "TaxonomyNodeReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNodeReference" ADD CONSTRAINT "TaxonomyNodeReference_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "TaxonomyNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNodeReference" ADD CONSTRAINT "TaxonomyNodeReference_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
