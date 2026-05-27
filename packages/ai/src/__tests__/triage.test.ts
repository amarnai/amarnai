import { describe, it, expect, vi } from "vitest";
import { validateTriageMetadata } from "../triage/validator.js";
import { analyzeThreadTriage } from "../triage/analyze.js";
import { buildTriagePrompt } from "../triage/prompt.js";
import type { AIProvider, ThreadMessage } from "../types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_TRIAGE_JSON = JSON.stringify({
  priority: "HIGH",
  urgency: "TODAY",
  riskLevel: "MEDIUM",
  requiredAction: "REPLY",
  sensitivity: "NORMAL",
  dueAt: "2026-06-01T00:00:00Z",
  suggestedNextStep: "CREATE_DRAFT",
});

const MESSAGES: ThreadMessage[] = [
  {
    subject: "Invoice overdue",
    senderEmail: "billing@vendor.com",
    senderName: "Billing Dept",
    bodyText: "Your invoice #1234 is overdue. Please pay by June 1st.",
    receivedAt: new Date("2026-05-27T09:00:00Z"),
  },
];

function makeMockProvider(response: string): AIProvider {
  return {
    providerName: "mock",
    modelName: "mock-v1",
    async chat() {
      return response;
    },
  };
}

// ─── validateTriageMetadata ───────────────────────────────────────────────────

describe("validateTriageMetadata", () => {
  it("parses a valid triage response", () => {
    const result = validateTriageMetadata(VALID_TRIAGE_JSON);
    expect(result).not.toBeNull();
    expect(result!.priority).toBe("HIGH");
    expect(result!.urgency).toBe("TODAY");
    expect(result!.riskLevel).toBe("MEDIUM");
    expect(result!.requiredAction).toBe("REPLY");
    expect(result!.sensitivity).toBe("NORMAL");
    expect(result!.dueAt).toBe("2026-06-01T00:00:00.000Z");
    expect(result!.suggestedNextStep).toBe("CREATE_DRAFT");
  });

  it("returns null dueAt for JSON null", () => {
    const json = JSON.stringify({ ...JSON.parse(VALID_TRIAGE_JSON), dueAt: null });
    const result = validateTriageMetadata(json);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });

  it("returns null dueAt for missing dueAt field", () => {
    const parsed = JSON.parse(VALID_TRIAGE_JSON);
    delete parsed.dueAt;
    const result = validateTriageMetadata(JSON.stringify(parsed));
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });

  it("normalises date-only dueAt string to ISO 8601", () => {
    const json = JSON.stringify({ ...JSON.parse(VALID_TRIAGE_JSON), dueAt: "2026-06-01" });
    const result = validateTriageMetadata(json);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toMatch(/^2026-06-01T/);
  });

  it("normalises datetime-without-timezone dueAt to ISO 8601", () => {
    const json = JSON.stringify({ ...JSON.parse(VALID_TRIAGE_JSON), dueAt: "2026-06-01T09:00:00" });
    const result = validateTriageMetadata(json);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toMatch(/^2026-06-01T/);
  });

  it("returns null dueAt for the string literal 'null'", () => {
    const json = JSON.stringify({ ...JSON.parse(VALID_TRIAGE_JSON), dueAt: "null" });
    const result = validateTriageMetadata(json);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });

  it("returns null dueAt for an unparseable date string without failing the whole record", () => {
    const json = JSON.stringify({ ...JSON.parse(VALID_TRIAGE_JSON), dueAt: "sometime next week" });
    const result = validateTriageMetadata(json);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
    // Other fields should still be present
    expect(result!.priority).toBe("HIGH");
  });

  it("tolerates markdown-fenced JSON", () => {
    const fenced = "```json\n" + VALID_TRIAGE_JSON + "\n```";
    const result = validateTriageMetadata(fenced);
    expect(result).not.toBeNull();
    expect(result!.priority).toBe("HIGH");
  });

  it("returns null for invalid JSON", () => {
    expect(validateTriageMetadata("not json")).toBeNull();
  });

  it("returns null when a required enum field has an unknown value", () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID_TRIAGE_JSON), priority: "CRITICAL" });
    expect(validateTriageMetadata(bad)).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    const parsed = JSON.parse(VALID_TRIAGE_JSON);
    delete parsed.requiredAction;
    expect(validateTriageMetadata(JSON.stringify(parsed))).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(validateTriageMetadata("")).toBeNull();
  });
});

// ─── buildTriagePrompt ────────────────────────────────────────────────────────

describe("buildTriagePrompt", () => {
  it("returns a system + user message pair", () => {
    const msgs = buildTriagePrompt(MESSAGES);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("includes email content in user message", () => {
    const msgs = buildTriagePrompt(MESSAGES);
    expect(msgs[1]!.content).toContain("Invoice overdue");
    expect(msgs[1]!.content).toContain("billing@vendor.com");
  });

  it("labels latest vs earlier messages in multi-message threads", () => {
    const multi: ThreadMessage[] = [
      {
        subject: "First",
        senderEmail: "a@example.com",
        senderName: null,
        bodyText: "Earlier context",
        receivedAt: new Date("2026-05-20T08:00:00Z"),
      },
      {
        subject: "Reply",
        senderEmail: "b@example.com",
        senderName: null,
        bodyText: "Latest follow-up",
        receivedAt: new Date("2026-05-27T09:00:00Z"),
      },
    ];
    const msgs = buildTriagePrompt(multi);
    const user = msgs[1]!.content;
    expect(user).toContain("Latest message");
    expect(user).toContain("Earlier thread context");
  });

  it("sorts messages chronologically before labelling", () => {
    // Pass messages in reverse order — prompt should still label correctly.
    const reversed: ThreadMessage[] = [
      {
        subject: "Latest",
        senderEmail: "b@example.com",
        senderName: null,
        bodyText: "This is the last message",
        receivedAt: new Date("2026-05-27T12:00:00Z"),
      },
      {
        subject: "Earlier",
        senderEmail: "a@example.com",
        senderName: null,
        bodyText: "This is the first message",
        receivedAt: new Date("2026-05-20T08:00:00Z"),
      },
    ];
    const msgs = buildTriagePrompt(reversed);
    const user = msgs[1]!.content;
    // Latest message section should contain the later one
    const latestIdx = user.indexOf("Latest message");
    const earlierIdx = user.indexOf("Earlier thread context");
    expect(latestIdx).toBeGreaterThan(-1);
    expect(earlierIdx).toBeGreaterThan(-1);
    // "This is the last message" should appear in the latest section
    const latestSection = user.slice(latestIdx, earlierIdx);
    expect(latestSection).toContain("This is the last message");
  });
});

// ─── analyzeThreadTriage ──────────────────────────────────────────────────────

describe("analyzeThreadTriage", () => {
  it("returns parsed triage metadata on valid LLM output", async () => {
    const provider = makeMockProvider(VALID_TRIAGE_JSON);
    const result = await analyzeThreadTriage(provider, MESSAGES);
    expect(result).not.toBeNull();
    expect(result!.priority).toBe("HIGH");
    expect(result!.urgency).toBe("TODAY");
    expect(result!.suggestedNextStep).toBe("CREATE_DRAFT");
  });

  it("returns null when the LLM returns unparseable output", async () => {
    const provider = makeMockProvider("I cannot determine triage metadata for this email.");
    const result = await analyzeThreadTriage(provider, MESSAGES);
    expect(result).toBeNull();
  });

  it("returns null when the LLM call throws", async () => {
    const provider: AIProvider = {
      providerName: "mock",
      modelName: "mock-v1",
      async chat() {
        throw new Error("network timeout");
      },
    };
    const result = await analyzeThreadTriage(provider, MESSAGES);
    expect(result).toBeNull();
  });

  it("calls the LLM provider exactly once", async () => {
    const chatSpy = vi.fn<() => Promise<string>>().mockResolvedValue(VALID_TRIAGE_JSON);
    const provider: AIProvider = { providerName: "mock", modelName: "mock-v1", chat: chatSpy };
    await analyzeThreadTriage(provider, MESSAGES);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });
});
