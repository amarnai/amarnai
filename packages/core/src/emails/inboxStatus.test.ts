import { describe, it, expect } from "vitest";
import { resolveInboxStatus, type InboxStatusInput } from "./inboxStatus.js";

// Baseline: connected inbox, healthy taxonomy, nothing pending, no backfill.
const base: InboxStatusInput = {
  waitingCount: 0,
  routableNodeCount: 5,
  threadCount: 20,
  backfillStatus: "DONE",
  backfillRoutingStarted: false,
  backfillLimitState: "NONE",
  backfillAwaitingTaxonomy: false,
  workspacePlan: "FREE",
  planCapDismissed: false,
};

describe("resolveInboxStatus", () => {
  it("returns null when there is nothing to surface", () => {
    expect(resolveInboxStatus(base)).toBeNull();
  });

  it("takes over the pane when the inbox is empty and has no plan", () => {
    expect(
      resolveInboxStatus({ ...base, threadCount: 0, routableNodeCount: 0 }),
    ).toEqual({ kind: "no-plan-empty" });
  });

  it("does NOT take over once any thread exists, even without a plan", () => {
    const s = resolveInboxStatus({
      ...base,
      threadCount: 12,
      routableNodeCount: 0,
      waitingCount: 12,
    });
    expect(s).toEqual({ kind: "no-plan", waitingCount: 12 });
  });

  it("shows no-plan when a backlog waits but the taxonomy is too weak", () => {
    expect(
      resolveInboxStatus({ ...base, waitingCount: 8, routableNodeCount: 2 }),
    ).toEqual({ kind: "no-plan", waitingCount: 8 });
  });

  it("shows pending when a backlog is ready and routing has not started", () => {
    expect(resolveInboxStatus({ ...base, waitingCount: 23 })).toEqual({
      kind: "pending",
      waitingCount: 23,
    });
  });

  it("drops the pending CTA once routing has started", () => {
    expect(
      resolveInboxStatus({ ...base, waitingCount: 23, backfillRoutingStarted: true }),
    ).toBeNull();
  });

  it("pending outranks plan-cap when both are true", () => {
    const s = resolveInboxStatus({
      ...base,
      waitingCount: 23,
      backfillLimitState: "BLOCKED",
    });
    expect(s).toEqual({ kind: "pending", waitingCount: 23 });
  });

  it("shows plan-cap when nothing is sortable and the limit was reached", () => {
    expect(
      resolveInboxStatus({ ...base, backfillLimitState: "CAPPED" }),
    ).toEqual({ kind: "plan-cap", limitState: "CAPPED", plan: "FREE" });
  });

  it("hides plan-cap once dismissed, falling through to backfill", () => {
    const s = resolveInboxStatus({
      ...base,
      backfillLimitState: "BLOCKED",
      planCapDismissed: true,
      backfillStatus: "RUNNING",
    });
    expect(s).toEqual({ kind: "backfill", awaitingTaxonomy: false });
  });

  it("shows backfill as the lowest priority while it runs", () => {
    expect(
      resolveInboxStatus({ ...base, backfillStatus: "RUNNING", backfillAwaitingTaxonomy: true }),
    ).toEqual({ kind: "backfill", awaitingTaxonomy: true });
  });

  it("no-plan (weak taxonomy) outranks a running backfill", () => {
    const s = resolveInboxStatus({
      ...base,
      waitingCount: 5,
      routableNodeCount: 1,
      backfillStatus: "RUNNING",
    });
    expect(s).toEqual({ kind: "no-plan", waitingCount: 5 });
  });
});
