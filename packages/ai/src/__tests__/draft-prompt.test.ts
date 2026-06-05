import { describe, it, expect } from "vitest";
import { buildDraftPrompt } from "../draft/prompt.js";
import type { DraftContext } from "../draft/prompt.js";
import type { ThreadMessage } from "../types.js";

const MSG: ThreadMessage = {
  subject: "Test subject",
  senderEmail: "sender@example.com",
  senderName: "Sender",
  bodyText: "Hello, please reply.",
  receivedAt: new Date("2026-01-01T10:00:00Z"),
};

const BASE_CONTEXT: DraftContext = {
  requiredAction: null,
  suggestedNextStep: null,
  explanation: null,
  finalNodeName: null,
  senderEmail: null,
  draftInstructions: null,
};

describe("buildDraftPrompt — system prompt", () => {
  it("always contains the JSON format directive", () => {
    const [system] = buildDraftPrompt([MSG], BASE_CONTEXT);
    expect(system!.content).toContain("Return ONLY valid JSON");
    expect(system!.content).toContain('"subject"');
    expect(system!.content).toContain('"body"');
  });

  it("without draftInstructions: no additional style guidance section", () => {
    const [system] = buildDraftPrompt([MSG], { ...BASE_CONTEXT, draftInstructions: null });
    expect(system!.content).not.toContain("Additional style guidance");
  });

  it("with draftInstructions: injects guidance between reply policy and JSON directive", () => {
    const guidance = "Reply formally. Keep responses under 3 sentences.";
    const [system] = buildDraftPrompt([MSG], { ...BASE_CONTEXT, draftInstructions: guidance });
    const content = system!.content;

    expect(content).toContain("Additional style guidance for this category:");
    expect(content).toContain(guidance);

    // Style guidance must appear before the JSON format directive
    const guidancePos = content.indexOf("Additional style guidance");
    const jsonPos = content.indexOf("Return ONLY valid JSON");
    expect(guidancePos).toBeGreaterThan(-1);
    expect(jsonPos).toBeGreaterThan(guidancePos);

    // Reply policy must appear before the style guidance
    const policyPos = content.indexOf("Reply policy:");
    expect(policyPos).toBeGreaterThan(-1);
    expect(guidancePos).toBeGreaterThan(policyPos);
  });

  it("with draftInstructions: JSON format directive is still present and last", () => {
    const guidance = "Always start with a greeting.";
    const [system] = buildDraftPrompt([MSG], { ...BASE_CONTEXT, draftInstructions: guidance });
    const content = system!.content;
    const jsonPos = content.indexOf("Return ONLY valid JSON");
    expect(jsonPos).toBeGreaterThan(-1);
    // Nothing meaningful after the JSON directive
    expect(content.slice(jsonPos)).toContain('"subject"');
  });

  it("role is system", () => {
    const [system] = buildDraftPrompt([MSG], BASE_CONTEXT);
    expect(system!.role).toBe("system");
  });
});

describe("buildDraftPrompt — user message", () => {
  it("second message has role user", () => {
    const msgs = buildDraftPrompt([MSG], BASE_CONTEXT);
    expect(msgs[1]!.role).toBe("user");
  });

  it("includes thread content", () => {
    const [, user] = buildDraftPrompt([MSG], BASE_CONTEXT);
    expect(user!.content).toContain("sender@example.com");
    expect(user!.content).toContain("Hello, please reply.");
  });

  it("includes triage context when provided", () => {
    const ctx: DraftContext = {
      ...BASE_CONTEXT,
      finalNodeName: "Legal",
      senderEmail: "me@example.com",
      draftInstructions: null,
    };
    const [, user] = buildDraftPrompt([MSG], ctx);
    expect(user!.content).toContain("Thread category: Legal");
    expect(user!.content).toContain("Replying as: me@example.com");
  });
});
