import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockBuildInboxProfile,
  mockResolveInboxQuota,
  mockRecordMeterUsage,
  mockGenerateTaxonomyFromProfile,
  mockComputeGenerationEligibility,
} = vi.hoisted(() => ({
  mockBuildInboxProfile: vi.fn(),
  mockResolveInboxQuota: vi.fn(),
  mockRecordMeterUsage: vi.fn(),
  mockGenerateTaxonomyFromProfile: vi.fn(),
  mockComputeGenerationEligibility: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => {
  const db = {
    workspace: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    taxonomyGenerationState: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
    emailConnection: { findUnique: vi.fn() },
    // The meter increment + READY proposal now commit in one transaction; the mock
    // runs the callback with the same client so the upsert/meter mocks still fire.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(db)),
  };
  return {
    db,
    buildInboxProfile: mockBuildInboxProfile,
    resolveInboxQuota: mockResolveInboxQuota,
    recordMeterUsage: mockRecordMeterUsage,
    taxonomyGenDedupToken: (k: string) => `TAXONOMY_GEN_${k}`,
  };
});

vi.mock("@amarnai/ai", () => ({
  createAIProvider: vi.fn().mockReturnValue({ providerName: "mock", modelName: "mock-model" }),
  getTaxonomyAIProviderConfig: vi.fn().mockReturnValue({}),
  generateTaxonomyFromProfile: mockGenerateTaxonomyFromProfile,
}));

vi.mock("@amarnai/config", () => ({
  config: { billing: { enforceTaxonomyQuota: true } },
}));

vi.mock("@amarnai/core/taxonomy", () => ({
  matchTemplateToProfile: vi.fn().mockReturnValue({ id: "tmpl-1", name: "Work", file: { nodes: [] } }),
  layoutTaxonomyTransfer: (f: unknown) => f,
  localizeTransferFile: (f: unknown) => f,
}));

vi.mock("@lingui/core", () => ({ setupI18n: vi.fn().mockReturnValue({}) }));

vi.mock("@amarnai/i18n", () => ({
  loadCatalog: vi.fn().mockResolvedValue({}),
  matchLocale: vi.fn().mockReturnValue("en"),
  translateSource: (_i: unknown, s: string) => s,
  LOCALE_ENGLISH_LANGUAGE_NAMES: { en: "English" },
}));

vi.mock("@amarnai/shared", () => ({
  computeGenerationEligibility: mockComputeGenerationEligibility,
}));

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((_q: string, processor: unknown) => ({ _processor: processor, on: vi.fn() })),
}));

vi.mock("../redis.js", () => ({ redisConnection: {} }));
vi.mock("../queues.js", () => ({
  generateTaxonomyQueue: { add: vi.fn() },
  QUEUE_GENERATE_TAXONOMY: "generate-taxonomy",
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { db } from "@amarnai/db";
import { runGenerateTaxonomyJob } from "../jobs/generate-taxonomy.js";

const WS_ID = "ws-1";
const WINDOW = new Date("2026-06-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspace.findUnique).mockResolvedValue({ plan: "PRO" } as never);
  vi.mocked(db.taxonomyGenerationState.findUnique).mockResolvedValue(null as never);
  vi.mocked(db.taxonomyGenerationState.upsert).mockResolvedValue({} as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({ emailAddress: "ben@gmail.com" } as never);
  mockBuildInboxProfile.mockResolvedValue({ eligibleThreadCount: 80, senderDomains: ["a", "b", "c"] });
  mockResolveInboxQuota.mockResolvedValue({
    inboxKey: "ben@gmail.com",
    windowStart: WINDOW,
    plan: "PRO",
    used: 0,
  });
  mockComputeGenerationEligibility.mockReturnValue({ eligible: true, reason: "OK" });
  mockGenerateTaxonomyFromProfile.mockResolvedValue({ file: { nodes: [] }, usedFallback: false });
  mockRecordMeterUsage.mockResolvedValue(undefined);
});

describe("runGenerateTaxonomyJob idempotency", () => {
  it("commits the meter and the READY proposal in one transaction, keyed on the job id", async () => {
    await runGenerateTaxonomyJob(WS_ID, "en", "job-7");

    // One transaction wraps both writes.
    expect(db.$transaction).toHaveBeenCalledOnce();
    // Meter keyed on the job's idempotency key, carrying the transaction client.
    expect(mockRecordMeterUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "TAXONOMY_GEN",
        delta: 1,
        dedupToken: "TAXONOMY_GEN_job-7",
        tx: expect.anything(),
      }),
    );
    // The READY proposal is written in the same transaction.
    const readyWrite = vi.mocked(db.taxonomyGenerationState.upsert).mock.calls.find(
      (c) => (c[0] as { update: { status?: string } }).update?.status === "READY",
    );
    expect(readyWrite).toBeDefined();
  });

  it("a retry with the same job id produces the SAME dedup token (one meter unit)", async () => {
    await runGenerateTaxonomyJob(WS_ID, "en", "job-7");
    await runGenerateTaxonomyJob(WS_ID, "en", "job-7");

    const tokens = mockRecordMeterUsage.mock.calls.map((c) => (c[0] as { dedupToken: string }).dedupToken);
    expect(tokens).toEqual(["TAXONOMY_GEN_job-7", "TAXONOMY_GEN_job-7"]);
  });

  it("falls open (meters without a dedup token) when no job key is provided", async () => {
    await runGenerateTaxonomyJob(WS_ID, "en"); // no idempotencyKey

    // Fail-open: still counts, but with NO per-workspace-constant token (which would
    // suppress every future generation). dedupToken must be undefined, not a fallback.
    expect(mockRecordMeterUsage).toHaveBeenCalledOnce();
    expect(mockRecordMeterUsage.mock.calls[0]![0].dedupToken).toBeUndefined();
  });

  it("does not meter or write READY when the inbox is ineligible (no LLM call)", async () => {
    mockComputeGenerationEligibility.mockReturnValue({ eligible: false, reason: "INBOX_TOO_SMALL" });

    await runGenerateTaxonomyJob(WS_ID, "en", "job-7");

    expect(mockGenerateTaxonomyFromProfile).not.toHaveBeenCalled();
    expect(mockRecordMeterUsage).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
