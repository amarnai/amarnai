import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Structural guarantee: the inbox usage meters are reset-immune. They must NEVER
// be referenced by any workspace/account teardown, or a reset would refund spent
// LLM cost — the exact bug this whole feature closes. This test fails loudly if a
// future edit adds them to a teardown transaction.
const workspaceOps = readFileSync(
  fileURLToPath(new URL("./workspace-ops.ts", import.meta.url)),
  "utf8",
);

describe("reset-immunity of inbox usage meters", () => {
  it("workspace-ops teardown never touches InboxUsageMeter or InboxBackfillGrant", () => {
    expect(workspaceOps).not.toMatch(/inboxUsageMeter/i);
    expect(workspaceOps).not.toMatch(/inboxBackfillGrant/i);
  });

  it("workspace-ops never DELETES a TrialClaim (deleteUserCascade only writes one) and never touches PendingSubscriptionCancellation", () => {
    // A consumed trial must survive account deletion, so the cascade may upsert a
    // TrialClaim but must never delete one. The pending-cancellation table is
    // owned by the billing worker and must not appear in a teardown at all.
    expect(workspaceOps).not.toMatch(/trialClaim\.delete/i);
    expect(workspaceOps).not.toMatch(/pendingSubscriptionCancellation/i);
  });

  it("the three teardown functions still exist (guards against the file being renamed away)", () => {
    expect(workspaceOps).toMatch(/resetWorkspaceData/);
    expect(workspaceOps).toMatch(/deleteWorkspaceCascade/);
    expect(workspaceOps).toMatch(/deleteUserCascade/);
  });
});
