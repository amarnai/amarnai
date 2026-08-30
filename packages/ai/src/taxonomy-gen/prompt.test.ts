import { describe, it, expect } from "vitest";
import type { InboxProfile, TaxonomyTransferFile } from "@aziru/shared";
import { buildTaxonomyGenerationMessages, buildRepairMessage } from "./prompt.js";

const SEED: TaxonomyTransferFile = {
  amarnaiTaxonomyVersion: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  nodes: [
    {
      ref: "root",
      name: "Inbox",
      description: null,
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: true,
      positionX: 0,
      positionY: 0,
    },
    {
      ref: "clients",
      name: "Clients",
      description: "Active client work and approvals.",
      instructions: null,
      draftPrompt: null,
      examples: [],
      isRoot: false,
      positionX: 300,
      positionY: 0,
    },
  ],
  edges: [{ sourceRef: "root", targetRef: "clients" }],
};

const PROFILE: InboxProfile = {
  eligibleThreadCount: 100,
  senderDomains: [],
  senderNames: [],
  subjectKeywords: [],
  gmailLabels: [],
  senderClusters: [],
};

describe("buildTaxonomyGenerationMessages", () => {
  it("instructs the model to write in the target language and keep refs ASCII", () => {
    const messages = buildTaxonomyGenerationMessages(PROFILE, SEED, "Freelancer", "French");
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("in French");
    expect(system).toMatch(/ASCII slug/i);
    expect(system).toMatch(/named exactly "Inbox"/);
    // The user message restates the language requirement.
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("French");
  });

  it("does not hardcode a single character floor that breaks CJK", () => {
    const system = buildTaxonomyGenerationMessages(PROFILE, SEED, "Freelancer", "Japanese")
      .find((m) => m.role === "system")!.content;
    // CJK guidance must be present so 2-character names are allowed.
    expect(system).toMatch(/Chinese or Japanese/);
  });
});

describe("buildRepairMessage", () => {
  it("re-asserts the target language and ASCII refs", () => {
    const repair = buildRepairMessage("shape invalid", "German");
    expect(repair.content).toContain("German");
    expect(repair.content).toMatch(/ASCII slug/i);
  });
});
