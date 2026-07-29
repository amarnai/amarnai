-- CreateEnum
CREATE TYPE "OutlookAccountType" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- AlterTable
ALTER TABLE "EmailConnection" ADD COLUMN     "outlookAccountType" "OutlookAccountType";
