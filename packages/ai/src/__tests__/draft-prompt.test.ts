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

describe("buildDraftPrompt — body cleaning and budget", () => {
  function msg(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
    return { ...MSG, ...overrides };
  }

  it("strips the quoted reply chain from the message being answered", () => {
    // Otherwise the model writes a reply to a verbatim copy of the previous
    // message rather than to the new text on top of it.
    const reply = [
      "Friday works for me.",
      "",
      "On Mon, Jan 1, 2026 at 10:00 AM Sender <sender@example.com> wrote:",
      "> Can you do Thursday or Friday?",
    ].join("\n");
    const [, user] = buildDraftPrompt(
      [
        msg({ bodyText: "Can you do Thursday or Friday?", receivedAt: new Date("2026-01-01T10:00:00Z") }),
        msg({ bodyText: reply, receivedAt: new Date("2026-01-02T10:00:00Z") }),
      ],
      BASE_CONTEXT
    );
    expect(user!.content).toContain("Friday works for me");
    expect(user!.content).not.toContain("wrote:");
    // The question appears once, in the message that asked it.
    expect(user!.content.match(/Thursday or Friday/g)).toHaveLength(1);
  });

  it("strips a quoted chain whose attribution line is not English", () => {
    const reply = [
      "Vendredi me convient.",
      "",
      "Le lun. 1 janv. 2026 a 10:00, Sender <sender@example.com> a ecrit :",
      "> Jeudi ou vendredi ?",
    ].join("\n");
    const [, user] = buildDraftPrompt(
      [
        msg({ bodyText: "Jeudi ou vendredi ?", receivedAt: new Date("2026-01-01T10:00:00Z") }),
        msg({ bodyText: reply, receivedAt: new Date("2026-01-02T10:00:00Z") }),
      ],
      BASE_CONTEXT
    );
    expect(user!.content).toContain("Vendredi me convient");
    expect(user!.content).not.toContain("a ecrit :");
  });

  it("keeps the first message's quoted block, which is a forward rather than a duplicate", () => {
    const forwarded = [
      "FYI, can you handle this?",
      "",
      "On Mon, Jan 1, 2026 at 9:00 AM Ana <ana@acme.com> wrote:",
      "> The contract needs signing by Friday.",
    ].join("\n");
    const [, user] = buildDraftPrompt([msg({ bodyText: forwarded })], BASE_CONTEXT);
    expect(user!.content).toContain("The contract needs signing by Friday");
  });

  it("gives an earlier message far more room than the old fixed 500-character head", () => {
    // The regression this guards: earlier context used to be cut at 500
    // characters, which on a real reply is barely past the greeting.
    const earlierBody = `START${"e".repeat(1_500)}END`;
    const [, user] = buildDraftPrompt(
      [
        msg({ bodyText: earlierBody, receivedAt: new Date("2026-01-01T10:00:00Z") }),
        msg({ bodyText: "Latest.", receivedAt: new Date("2026-01-02T10:00:00Z") }),
      ],
      BASE_CONTEXT
    );
    expect(user!.content).toContain("START");
    expect(user!.content).toContain("END");
    expect(user!.content.match(/e+/g)!.some((run) => run.length === 1_500)).toBe(true);
  });

  it("keeps a body that is nothing but a sign-off, rather than emptying it", () => {
    // Cleaning strips sign-offs; a one-word "Thanks" would otherwise clean to
    // nothing and render as "(no body)", leaving the model to answer a message it
    // cannot see.
    const [, user] = buildDraftPrompt([msg({ bodyText: "Thanks" })], BASE_CONTEXT);
    expect(user!.content).toContain("Thanks");
    expect(user!.content).not.toContain("(no body)");
  });

  it("keeps the latest message whole and caps the prompt on a very long thread", () => {
    const latestBody = `LATEST-HEAD${"l".repeat(15_000)}LATEST-TAIL`;
    const messages = [
      ...Array.from({ length: 60 }, (_, i) =>
        msg({ bodyText: `old-${i} ` + "x".repeat(400), receivedAt: new Date(Date.UTC(2026, 0, 1, i)) })
      ),
      msg({ bodyText: latestBody, receivedAt: new Date(Date.UTC(2026, 0, 5)) }),
    ];
    const [, user] = buildDraftPrompt(messages, BASE_CONTEXT);
    expect(user!.content).toContain("LATEST-HEAD");
    expect(user!.content).toContain("LATEST-TAIL");
    // The oldest are dropped and the omission is stated, rather than every
    // message contributing a sliver with no ceiling on the total.
    expect(user!.content).toMatch(/\[\.\.\. \d+ earlier messages omitted \.\.\.\]/);
    expect(user!.content).not.toContain("old-0 ");
    expect(user!.content.length).toBeLessThan(25_000);
  });
});
