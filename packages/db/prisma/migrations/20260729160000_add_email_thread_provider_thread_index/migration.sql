-- Lets the injected mail-client surfaces resolve a provider thread id to our
-- thread with a single indexed lookup, instead of fanning out over the
-- workspace's email accounts first.
CREATE INDEX "EmailThread_workspaceId_providerThreadId_idx" ON "EmailThread"("workspaceId", "providerThreadId");
