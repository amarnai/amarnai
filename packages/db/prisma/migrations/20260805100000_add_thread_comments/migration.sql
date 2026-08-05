-- Thread comments: team discussion on a thread, plus a per-member read marker
-- that drives the unread badge. Additive; no backfill needed.

-- One comment. `body` is user-generated (may quote email content — never
-- logged). Mentions are stored structurally in `mentionUserIds`; notifications
-- are driven by that array only.
CREATE TABLE "ThreadComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentionUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ThreadComment_emailThreadId_createdAt_idx" ON "ThreadComment"("emailThreadId", "createdAt");

CREATE INDEX "ThreadComment_workspaceId_idx" ON "ThreadComment"("workspaceId");

ALTER TABLE "ThreadComment" ADD CONSTRAINT "ThreadComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThreadComment" ADD CONSTRAINT "ThreadComment_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreadComment" ADD CONSTRAINT "ThreadComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Per-member read marker, one row per (thread, user), upserted when the member
-- opens the comment section.
CREATE TABLE "ThreadCommentRead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadCommentRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreadCommentRead_emailThreadId_userId_key" ON "ThreadCommentRead"("emailThreadId", "userId");

CREATE INDEX "ThreadCommentRead_workspaceId_idx" ON "ThreadCommentRead"("workspaceId");

ALTER TABLE "ThreadCommentRead" ADD CONSTRAINT "ThreadCommentRead_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreadCommentRead" ADD CONSTRAINT "ThreadCommentRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
