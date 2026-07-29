-- The injected panel's queue asks the workspace for threads that have a PROPOSED
-- draft waiting for approval, which is an exists-subquery over the whole Draft
-- table. The same index also serves the thread list's per-row draft select.
CREATE INDEX "Draft_emailThreadId_status_idx" ON "Draft"("emailThreadId", "status");
