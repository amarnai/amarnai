-- CreateEnum
CREATE TYPE "TriageStatus" AS ENUM ('PENDING', 'SORTED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "EmailThread" ADD COLUMN "triageStatus" "TriageStatus" NOT NULL DEFAULT 'PENDING';
