-- CreateEnum
CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE';
