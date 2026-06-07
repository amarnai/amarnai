-- Add trialUsed to User
ALTER TABLE "User" ADD COLUMN "trialUsed" BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: mark users whose owned workspaces had trialUsed = true
UPDATE "User" u
SET "trialUsed" = TRUE
WHERE EXISTS (
  SELECT 1 FROM "Workspace" w
  WHERE w."ownerUserId" = u.id AND w."trialUsed" = TRUE
);

-- Remove trialUsed from Workspace
ALTER TABLE "Workspace" DROP COLUMN "trialUsed";
