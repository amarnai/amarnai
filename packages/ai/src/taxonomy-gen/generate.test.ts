import { describe, it, expect } from "vitest";
import {
  TaxonomyTransferFileSchema,
  validateTaxonomyTransfer,
  type InboxProfile,
  type TaxonomyTransferFile,
} from "@aziru/shared";
import type { AIProvider } from "../types.js";
import { generateTaxonomyFromProfile } from "./generate.js";

const NOW = new Date("2026-06-24T12:00:00.000Z");

function validFile(): TaxonomyTransferFile {
  const node = (
    ref: string,
    name: string,
    description: string | null,
    isRoot = false,
    isCatchAll = false,
  ) => ({
    ref,
    name,
    description,
    instructions: null,
    draftPrompt: null,
    examples: [],
    isRoot,
    isCatchAll,
    positionX: 0,
    positionY: 0,
  });
  return {
    aziruTaxonomyVersion: 1,
    exportedAt: NOW.toISOString(),
    nodes: [
      node("root", "Inbox", null, true),
      node("a", "Clients", "Messages from and about active clients and their projects."),
      node("b", "Finance", "Invoices, payments, receipts, and other financial records."),
      node("c", "Personal", "Personal, non-work messages that still matter to you."),
      node("updates_other", "Updates / Other", "Automated notifications and bulk mail that doesn't fit another folder.", false, true),
    ],
    edges: [
      { sourceRef: "root", targetRef: "a" },
      { sourceRef: "root", targetRef: "b" },
      { sourceRef: "root", targetRef: "c" },
      { sourceRef: "root", targetRef: "updates_other" },
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
      targetLanguage: "English",
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
      targetLanguage: "English",
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
      targetLanguage: "English",
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

  it("falls back to the localized fallbackSeed, not the English seed", async () => {
    const localized = validFile();
    // Pretend these are the seed's names translated into the target language.
    localized.nodes[1]!.name = "Clientes";
    localized.nodes[2]!.name = "Finanzas";
    localized.nodes[3]!.name = "Personal";
    const provider = new MockProvider(["garbage", "still not valid"]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      targetLanguage: "Spanish",
      fallbackSeed: localized,
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.file.nodes.map((n) => n.name)).toContain("Clientes");
    expect(result.file.nodes.map((n) => n.name)).not.toContain("Clients");
  });

  it("falls back when the model returns structurally invalid taxonomy (cycle)", async () => {
    const bad = validFile();
    bad.edges.push({ sourceRef: "a", targetRef: "root" }); // root as target + cycle
    const provider = new MockProvider([JSON.stringify(bad), JSON.stringify(bad)]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      targetLanguage: "English",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(true);
  });

  it("designates a catch-all when the model omits it (no fallback)", async () => {
    // Model returns a structurally fine tree but drops every isCatchAll flag.
    const noCatchAll = validFile();
    for (const n of noCatchAll.nodes) n.isCatchAll = false;
    const provider = new MockProvider([JSON.stringify(noCatchAll)]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed, // seed's catch-all ref is "updates_other"
      matchedTemplateName: "Freelancer",
      targetLanguage: "English",
      provider,
      now: NOW,
    });
    // Normalized in-place, not fallen back to the seed.
    expect(result.usedFallback).toBe(false);
    expect(provider.calls).toBe(1);
    const catchAlls = result.file.nodes.filter((n) => n.isCatchAll);
    expect(catchAlls).toHaveLength(1);
    // Prefers the seed's catch-all ref when present in the output.
    expect(catchAlls[0]!.ref).toBe("updates_other");
    expect(validateTaxonomyTransfer(result.file).ok).toBe(true);
  });

  it("collapses multiple catch-alls down to exactly one", async () => {
    const many = validFile();
    // Flag two extra leaves as catch-all in addition to updates_other.
    for (const n of many.nodes) {
      if (n.ref === "a" || n.ref === "b") n.isCatchAll = true;
    }
    const provider = new MockProvider([JSON.stringify(many)]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      targetLanguage: "English",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(false);
    expect(result.file.nodes.filter((n) => n.isCatchAll)).toHaveLength(1);
    expect(validateTaxonomyTransfer(result.file).ok).toBe(true);
  });

  it("stamps a fresh envelope (version + timestamp), ignoring the model's", async () => {
    const tampered = { ...validFile(), aziruTaxonomyVersion: 99, exportedAt: "not-a-date" };
    const provider = new MockProvider([JSON.stringify(tampered)]);
    const result = await generateTaxonomyFromProfile({
      profile: PROFILE,
      seed,
      matchedTemplateName: "Freelancer",
      targetLanguage: "English",
      provider,
      now: NOW,
    });
    expect(result.usedFallback).toBe(false);
    expect(TaxonomyTransferFileSchema.safeParse(result.file).success).toBe(true);
    expect(result.file.exportedAt).toBe(NOW.toISOString());
  });
});
