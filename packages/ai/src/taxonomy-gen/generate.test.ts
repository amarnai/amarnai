import { describe, it, expect } from "vitest";
import {
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  type InboxProfile,
  type TaxonomyTransferFile,
} from "@amarnai/shared";
import type { AIProvider } from "../types.js";
import { generateTaxonomyFromProfile } from "./generate.js";

const NOW = new Date("2026-06-24T12:00:00.000Z");

function validFile(): TaxonomyTransferFile {
  const node = (ref: string, name: string, description: string | null, isRoot = false) => ({
    ref,
    name,
    description,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot,
    positionX: 0,
    positionY: 0,
  });
  return {
    amarnaiTaxonomyVersion: 1,
    exportedAt: NOW.toISOString(),
    nodes: [
      node("root", "Inbox", null, true),
      node("a", "Clients", "Messages from and about active clients and their projects."),
      node("b", "Finance", "Invoices, payments, receipts, and other financial records."),
      node("c", "Personal", "Personal, non-work messages that still matter to you."),
    ],
    edges: [
      { sourceRef: "root", targetRef: "a" },
      { sourceRef: "root", targetRef: "b" },
      { sourceRef: "root", targetRef: "c" },
    ],
  };
}

const PROFILE: InboxProfile = {
  eligibleThreadCount: 500,
  senderDomains: [{ term: "acme.com", count: 20 }],
  senderNames: [{ term: "Acme Billing", count: 10 }],
  subjectKeywords: [{ term: "invoice", count: 30 }],
  gmailLabels: [],
  senderClusters: [{ label: "acme.com", count: 20, keywords: [{ term: "invoice", count: 30 }] }],
};

class MockProvider implements AIProvider {
  readonly providerName = "mock";
  readonly modelName = "mock-1";
  calls = 0;
  constructor(private responses: string[]) {}
  async chat(): Promise<string> {
    const r = this.responses[this.calls] ?? this.responses[this.responses.length - 1]!;
    this.calls++;
    return r;
  }
}

const seed = validFile();

describe("generateTaxonomyFromProfile", () => {
  it("accepts valid LLM output on the first try", async () => {
    const provider = new MockProvider([JSON.stringify(validFile())]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(false);
    expect(provider.calls).toBe(1);
    expect(validateTaxonomyTransfer(result.file).ok).toBe(true);
  });

  it("repairs after a malformed first response", async () => {
    const provider = new MockProvider(["not json at all", JSON.stringify(validFile())]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(false);
    expect(provider.calls).toBe(2);
  });

  it("falls back to the seed when both attempts fail", async () => {
    const provider = new MockProvider(["garbage", "{ still: not valid"]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(true);
    expect(provider.calls).toBe(2);
    // The seed is always valid.
    expect(validateTaxonomyTransfer(result.file).ok).toBe(true);
    expect(result.file.nodes.map((n) => n.name).sort()).toEqual(
      seed.nodes.map((n) => n.name).sort(),
    );
  });

  it("falls back when the model returns structurally invalid taxonomy (cycle)", async () => {
    const bad = validFile();
    bad.edges.push({ sourceRef: "a", targetRef: "root" }); // root as target + cycle
    const provider = new MockProvider([JSON.stringify(bad), JSON.stringify(bad)]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(true);
  });

  it("stamps a fresh envelope (version + timestamp), ignoring the model's", async () => {
    const tampered = { ...validFile(), amarnaiTaxonomyVersion: 99, exportedAt: "not-a-date" };
    const provider = new MockProvider([JSON.stringify(tampered)]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(false);
    expect(TaxonomyTransferFileSchema.safeParse(result.file).success).toBe(true);
    expect(result.file.exportedAt).toBe(NOW.toISOString());
  });
});
