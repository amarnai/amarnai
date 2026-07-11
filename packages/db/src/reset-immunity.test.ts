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

// The two THREAD_SORT pre-check gate sites must read the SAME reset-immune inbox
// meter the classify worker accounts + gates on, never a deletable per-workspace
// EmailClassification count. Read their source so the structural guarantee below
// fails loudly if a future edit reintroduces a reset-refundable counter.
const syncInbox = readFileSync(
  fileURLToPath(new URL("../../../apps/worker/src/jobs/sync-inbox.ts", import.meta.url)),
  "utf8",
);
const gmailSort = readFileSync(
  fileURLToPath(new URL("../../../apps/api/src/routes/gmail-sort.ts", import.meta.url)),
  "utf8",
);

describe("reset-immunity of inbox usage meters", () => {
  it("workspace-ops teardown never touches InboxUsageMeter or InboxBackfillGrant", () => {
    expect(workspaceOps).not.toMatch(/inboxUsageMeter/i);
    expect(workspaceOps).not.toMatch(/inboxBackfillGrant/i);
  });

  it("workspace-ops teardown never touches IdempotencyMarker (a reset must not free a dedup token)", () => {
    // The idempotency ledger is what makes a retried/duplicated job charge a meter or
    // repeat a side effect at most once. If a reset deleted its markers, a re-run of an
    // already-metered chunk would claim a fresh token and double-charge — the same
    // reset-refund bug this whole feature closes. So it must never appear in a teardown.
    expect(workspaceOps).not.toMatch(/idempotencyMarker/i);
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

describe("THREAD_SORT quota gate reads the reset-immune meter, not deletable counts", () => {
  // resetWorkspaceData deletes EmailClassification rows but never the inbox meter
  // (asserted above). Therefore the THREAD_SORT pre-check gate must read the meter,
  // or a disconnect+reconnect would refund a capped user's monthly quota. These
  // structural checks pin both pre-enqueue gate sites to resolveInboxQuota and
  // forbid the old deletable-count helper from creeping back in.

  it("sync-inbox recovery gates on resolveInboxQuota (the inbox meter)", () => {
    expect(syncInbox).toMatch(/resolveInboxQuota\(/);
    expect(syncInbox).toMatch(/"THREAD_SORT"/);
    expect(syncInbox).not.toMatch(/countRecurringThreadSorts/);
  });

  it("the LIVE classify enqueue uses a deterministic dedup key, not a timestamped jobId (Issue 13)", () => {
    // A timestamped jobId made every enqueue unique, so two concurrent syncs could
    // enqueue two classify jobs for one thread that both metered/pushed. The fix keys
    // the enqueue on (workspace, thread) via DEDUP_CLASSIFY_LIVE so duplicates collapse.
    expect(syncInbox).toMatch(/DEDUP_CLASSIFY_LIVE/);
    expect(syncInbox).not.toMatch(/classify_\$\{workspaceId\}_\$\{emailThreadId\}_\$\{Date\.now\(\)\}/);
  });

  it("gmail-sort pre-check gates on resolveInboxQuota (the inbox meter)", () => {
    expect(gmailSort).toMatch(/resolveInboxQuota\(/);
    expect(gmailSort).toMatch(/"THREAD_SORT"/);
    expect(gmailSort).not.toMatch(/countRecurringThreadSorts/);
  });
});
