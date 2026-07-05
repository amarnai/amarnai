-- CreateEnum
CREATE TYPE "ExtensionBrowser" AS ENUM ('CHROME', 'FIREFOX');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extensionNudgedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExtensionInstall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "browser" "ExtensionBrowser" NOT NULL,
    "version" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtensionInstall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionInstall_userId_key" ON "ExtensionInstall"("userId");

-- AddForeignKey
ALTER TABLE "ExtensionInstall" ADD CONSTRAINT "ExtensionInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
