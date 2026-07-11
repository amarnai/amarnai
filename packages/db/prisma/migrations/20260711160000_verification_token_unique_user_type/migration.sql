-- Deduplicate before enforcing one token per (user, type): keep the newest row
-- for each (userId, type), breaking createdAt ties by id so no duplicates remain.
DELETE FROM "VerificationToken" a
USING "VerificationToken" b
WHERE a."userId" = b."userId"
  AND a."type" = b."type"
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

-- One live token per (user, type). Also serves as the userId index.
CREATE UNIQUE INDEX "VerificationToken_userId_type_key"
  ON "VerificationToken"("userId", "type");
