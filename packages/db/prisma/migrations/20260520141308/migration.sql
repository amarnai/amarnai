/*
  Warnings:

  - The values [GENIZOR] on the enum `TagSource` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TagSource_new" AS ENUM ('AMARNAI', 'GMAIL');
ALTER TABLE "Tag" ALTER COLUMN "source" TYPE "TagSource_new" USING ("source"::text::"TagSource_new");
ALTER TYPE "TagSource" RENAME TO "TagSource_old";
ALTER TYPE "TagSource_new" RENAME TO "TagSource";
DROP TYPE "public"."TagSource_old";
COMMIT;
