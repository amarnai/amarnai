-- Length-conditional summary format: prose by default, up to 3 bullets for
-- threads that genuinely enumerate facts.
--
-- A second migration rather than an amendment of 20260727120000_add_thread_summary:
-- that one is already applied to developer databases, and rewriting an applied
-- migration fails Prisma's checksum check (it would force a `migrate reset` and
-- destroy local data). Both are additive and unshipped, so prod sees them
-- together on the same deploy.

CREATE TYPE "ThreadSummaryFormat" AS ENUM ('PROSE', 'BULLETS');

-- Existing rows are prose written under prompt version 1. The defaults classify
-- them correctly; the version mismatch then makes them regenerate on next open
-- rather than serving pre-bullets output forever.
ALTER TABLE "ThreadSummary"
  ADD COLUMN "bullets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "format" "ThreadSummaryFormat" NOT NULL DEFAULT 'PROSE',
  ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT '1';
