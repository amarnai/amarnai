-- Lazy thread summaries: a cached AI TL;DR per thread, generated on first open.
-- Fully additive — no backfill, and workspaces that never open a thread never
-- create a row.

-- New cost meter. Additive enum value; no exhaustive switch reads MeterKind, and
-- existing rows are untouched. (Postgres 12+ permits ADD VALUE inside the
-- migration transaction as long as the new value is not referenced in it.)
ALTER TYPE "MeterKind" ADD VALUE 'THREAD_SUMMARY';

CREATE TYPE "ThreadSummaryStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- One row per thread: a cache, not a history. Regeneration overwrites in place,
-- invalidated by messageSetSignature (new/removed message) or locale change.
CREATE TABLE "ThreadSummary" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "status" "ThreadSummaryStatus" NOT NULL DEFAULT 'GENERATING',
    "summary" TEXT,
    "locale" TEXT NOT NULL,
    "model" TEXT,
    "messageSetSignature" TEXT NOT NULL,
    "errorMessage" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreadSummary_emailThreadId_key" ON "ThreadSummary"("emailThreadId");

CREATE INDEX "ThreadSummary_workspaceId_idx" ON "ThreadSummary"("workspaceId");

ALTER TABLE "ThreadSummary" ADD CONSTRAINT "ThreadSummary_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThreadSummary" ADD CONSTRAINT "ThreadSummary_emailThreadId_fkey" FOREIGN KEY ("emailThreadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
