-- Store a representative message deep-link per thread, for providers whose thread
-- id is not URL-resolvable (Outlook conversationId). Nullable; Gmail leaves it null.
ALTER TABLE "EmailThread" ADD COLUMN "webLink" TEXT;
