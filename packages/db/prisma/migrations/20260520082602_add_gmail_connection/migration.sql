-- CreateEnum
CREATE TYPE "GmailConnectionStatus" AS ENUM ('ACTIVE');

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "googleSubjectId" TEXT NOT NULL,
    "gmailAddress" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "grantedScopes" TEXT[],
    "status" "GmailConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_workspaceId_key" ON "GmailConnection"("workspaceId");

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
