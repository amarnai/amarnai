import { describe, it, expect } from "vitest";
import { normalizeGraphThread, type GraphMessage } from "./normalize-graph-thread.js";

function msg(overrides: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: "m1",
    conversationId: "conv-1",
    from: { emailAddress: { name: "Alice", address: "Alice@Example.com" } },
    toRecipients: [{ emailAddress: { address: "me@example.com" } }],
    ccRecipients: [],
    subject: "Hello",
    receivedDateTime: "2026-06-01T10:00:00Z",
    body: { contentType: "text", content: "plain body" },
    hasAttachments: false,
    isRead: false,
    webLink: "https://outlook.office.com/mail/id/m1",
    ...overrides,
  };
}

describe("normalizeGraphThread — grouping + shape", () => {
  it("groups a conversation's messages into one snapshot keyed by conversationId", () => {
    const snap = normalizeGraphThread([msg({ id: "m1" }), msg({ id: "m2" })], "conv-1");
    expect(snap.provider).toBe("outlook");
    expect(snap.providerThreadId).toBe("conv-1");
    expect(snap.messageCount).toBe(2);
    expect(snap.messages.map((m) => m.providerMessageId)).toEqual(["m1", "m2"]);
  });

  it("orders messages oldest-first and takes the subject from the earliest", () => {
    const older = msg({ id: "old", subject: "First", receivedDateTime: "2026-06-01T09:00:00Z" });
    const newer = msg({ id: "new", subject: "Re: First", receivedDateTime: "2026-06-01T11:00:00Z" });
    const snap = normalizeGraphThread([newer, older], "conv-1");
    expect(snap.messages[0]!.providerMessageId).toBe("old");
    expect(snap.subject).toBe("First");
    expect(snap.latestMessageAt.toISOString()).toBe("2026-06-01T11:00:00.000Z");
  });

  it("lowercases sender/participant addresses and dedups participants", () => {
    const a = msg({ id: "a", from: { emailAddress: { address: "Bob@Example.com" } } });
    const b = msg({ id: "b", from: { emailAddress: { address: "bob@example.com" } } });
    const snap = normalizeGraphThread([a, b], "conv-1");
    expect(snap.messages[0]!.senderEmail).toBe("bob@example.com");
    expect(snap.participants).toEqual(["bob@example.com"]);
  });

  it("captures the newest message's webLink as the thread deep-link", () => {
    const older = msg({ id: "old", receivedDateTime: "2026-06-01T09:00:00Z", webLink: "link-old" });
    const newer = msg({ id: "new", receivedDateTime: "2026-06-01T12:00:00Z", webLink: "link-new" });
    const snap = normalizeGraphThread([older, newer], "conv-1");
    expect(snap.webLink).toBe("link-new");
  });

  it("leaves labelIds empty (Outlook has no Gmail category vocabulary)", () => {
    const snap = normalizeGraphThread([msg()], "conv-1");
    expect(snap.messages[0]!.labelIds).toEqual([]);
  });
});

describe("normalizeGraphThread — body extraction", () => {
  it("prefers uniqueBody (quoted history already stripped) over body", () => {
    const snap = normalizeGraphThread(
      [
        msg({
          uniqueBody: { contentType: "text", content: "reply only" },
          body: { contentType: "text", content: "reply only\n\nOn ... wrote: quoted" },
        }),
      ],
      "conv-1",
    );
    expect(snap.messages[0]!.bodyExcerpt).toBe("reply only");
  });

  it("strips HTML from an html body", () => {
    const snap = normalizeGraphThread(
      [msg({ uniqueBody: null, body: { contentType: "html", content: "<p>Hi <b>there</b></p>" } })],
      "conv-1",
    );
    expect(snap.messages[0]!.bodyExcerpt).toBe("Hi there");
  });

  it("falls back to bodyPreview when no body content is present", () => {
    const snap = normalizeGraphThread(
      [msg({ uniqueBody: null, body: null, bodyPreview: "preview text" })],
      "conv-1",
    );
    expect(snap.messages[0]!.bodyExcerpt).toBe("preview text");
  });

  it("bounds the excerpt to 2000 characters", () => {
    const long = "x".repeat(5000);
    const snap = normalizeGraphThread(
      [msg({ uniqueBody: { contentType: "text", content: long } })],
      "conv-1",
    );
    expect(snap.messages[0]!.bodyExcerpt!.length).toBe(2000);
  });
});

describe("normalizeGraphThread — attachments + headers", () => {
  it("keeps real attachments and excludes inline ones", () => {
    const snap = normalizeGraphThread(
      [
        msg({
          attachments: [
            { name: "doc.pdf", contentType: "application/pdf", size: 1200, isInline: false },
            { name: "logo.png", contentType: "image/png", size: 50, isInline: true },
          ],
        }),
      ],
      "conv-1",
    );
    expect(snap.messages[0]!.attachments).toEqual([
      { filename: "doc.pdf", mimeType: "application/pdf", size: 1200 },
    ]);
  });

  it("extracts bulk/automation header markers from internetMessageHeaders", () => {
    const snap = normalizeGraphThread(
      [
        msg({
          internetMessageHeaders: [
            { name: "List-Unsubscribe", value: "<mailto:x>" },
            { name: "Auto-Submitted", value: "auto-generated" },
          ],
        }),
      ],
      "conv-1",
    );
    expect(snap.messages[0]!.automatedHeaders).toEqual({
      listUnsubscribe: true,
      listId: false,
      autoSubmitted: "auto-generated",
      precedence: null,
    });
  });
});
