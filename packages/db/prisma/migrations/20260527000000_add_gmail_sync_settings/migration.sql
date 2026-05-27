-- CreateTable
CREATE TABLE "GmailSyncSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "includeSpam" BOOLEAN NOT NULL DEFAULT false,
    "includePromotions" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailSyncSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailSyncSettings_workspaceId_key" ON "GmailSyncSettings"("workspaceId");

-- AddForeignKey
ALTER TABLE "GmailSyncSettings" ADD CONSTRAINT "GmailSyncSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
