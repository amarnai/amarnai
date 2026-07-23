import { describe, it, expect } from "vitest";
import { normalizeGmailThread, type RawGmailThread } from "./gmail-thread-adapter.js";

// Gmail returns part bodies as base64url-encoded strings.
function b64url(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type Header = { name: string; value: string };

function plainPart(text: string) {
  return { mimeType: "text/plain", body: { size: text.length, data: b64url(text) } };
}

function htmlPart(html: string) {
  return { mimeType: "text/html", body: { size: html.length, data: b64url(html) } };
}

function filePart(opts: {
  mimeType: string;
  filename: string;
  headers?: Header[];
}) {
  return {
    mimeType: opts.mimeType,
    filename: opts.filename,
    ...(opts.headers ? { headers: opts.headers } : {}),
    body: { size: 1234, attachmentId: "att-1" },
  };
}

function thread(payload: object): RawGmailThread {
  return {
    id: "thread-1",
    messages: [
      {
        id: "msg-1",
        threadId: "thread-1",
        internalDate: String(new Date("Wed, 03 Jun 2026 17:32:00 +0000").getTime()),
        payload: {
          headers: [
            { name: "From", value: "Sender <sender@example.com>" },
            { name: "Date", value: "Wed, 03 Jun 2026 17:32:00 +0000" },
            { name: "Subject", value: "Test" },
          ],
          body: { size: 0 },
          ...payload,
        },
      },
    ],
  } as RawGmailThread;
}

describe("normalizeGmailThread attachment detection", () => {
  it("keeps a real PDF attachment", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [
        plainPart("Please find the report attached."),
        filePart({ mimeType: "application/pdf", filename: "report.pdf" }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.attachments).toEqual([
      { filename: "report.pdf", mimeType: "application/pdf", size: 1234 },
    ]);
  });

  it("excludes an inline image referenced by cid: in the HTML body", () => {
    const raw = thread({
      mimeType: "multipart/related",
      parts: [
        htmlPart('<p>Hi</p><img src="cid:logo@efrei.net">'),
        filePart({
          mimeType: "image/png",
          filename: "image.png",
          headers: [{ name: "Content-ID", value: "<logo@efrei.net>" }],
        }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.attachments).toEqual([]);
  });

  it("excludes an inline image marked with a [cid:...] placeholder in plain text", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [
        plainPart("Best regards,\n[cid:logo@efrei.net]"),
        filePart({
          mimeType: "image/png",
          filename: "image.png",
          headers: [{ name: "Content-ID", value: "<logo@efrei.net>" }],
        }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.attachments).toEqual([]);
  });

  it("keeps a real attachment that has a Content-ID but is not referenced in the body", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [
        plainPart("See attached invoice."),
        filePart({
          mimeType: "application/pdf",
          filename: "Twice-Born.pdf",
          headers: [{ name: "Content-ID", value: "<doc-12345@mail>" }],
        }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.attachments).toEqual([
      { filename: "Twice-Born.pdf", mimeType: "application/pdf", size: 1234 },
    ]);
  });

  it("excludes inline images re-embedded in quoted reply history", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/related",
          body: { size: 0 },
          parts: [
            htmlPart(
              '<p>Not yet.</p><blockquote>On Jun 3 wrote:<img src="cid:sig@efrei.net"></blockquote>'
            ),
            filePart({
              mimeType: "image/png",
              filename: "image.png",
              headers: [{ name: "Content-ID", value: "<sig@efrei.net>" }],
            }),
          ],
        },
        filePart({ mimeType: "application/pdf", filename: "contract.pdf" }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.attachments).toEqual([
      { filename: "contract.pdf", mimeType: "application/pdf", size: 1234 },
    ]);
  });
});

describe("normalizeGmailThread inline image detection", () => {
  it("captures a cid-referenced image as an inline image, not an attachment", () => {
    const raw = thread({
      mimeType: "multipart/related",
      parts: [
        htmlPart('<p>Hi</p><img src="cid:logo@efrei.net">'),
        filePart({
          mimeType: "image/png",
          filename: "logo.png",
          headers: [{ name: "Content-ID", value: "<logo@efrei.net>" }],
        }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.attachments).toEqual([]);
    expect(snapshot.messages[0]!.inlineImages).toEqual([
      {
        attachmentId: "att-1",
        mimeType: "image/png",
        filename: "logo.png",
        size: 1234,
        contentId: "logo@efrei.net",
      },
    ]);
  });

  it("does not treat an image with an unreferenced Content-ID as inline", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [
        plainPart("See the diagram."),
        filePart({
          mimeType: "image/png",
          filename: "diagram.png",
          headers: [{ name: "Content-ID", value: "<diagram@mail>" }],
        }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    // Unreferenced → stays a normal attachment, never an inline image.
    expect(snapshot.messages[0]!.inlineImages).toEqual([]);
    expect(snapshot.messages[0]!.attachments).toEqual([
      { filename: "diagram.png", mimeType: "image/png", size: 1234 },
    ]);
  });

  it("does not treat a cid-referenced non-image part as an inline image", () => {
    const raw = thread({
      mimeType: "multipart/related",
      parts: [
        htmlPart('<p>See <a href="cid:doc@mail">doc</a></p>'),
        filePart({
          mimeType: "application/pdf",
          filename: "doc.pdf",
          headers: [{ name: "Content-ID", value: "<doc@mail>" }],
        }),
      ],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.inlineImages).toEqual([]);
  });

  it("returns an empty inlineImages list when there are no images", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [plainPart("Just text, no images.")],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.inlineImages).toEqual([]);
  });
});

describe("normalizeGmailThread receivedAt / ordering", () => {
  // Build a raw thread from (internalDate, Date-header) pairs. Both are provided
  // independently so tests can force them to disagree.
  function timestampThread(
    messages: Array<{ id: string; internalDate?: string; dateHeader?: string }>
  ): RawGmailThread {
    return {
      id: "thread-1",
      messages: messages.map((m) => ({
        id: m.id,
        threadId: "thread-1",
        ...(m.internalDate !== undefined ? { internalDate: m.internalDate } : {}),
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Sender <sender@example.com>" },
            ...(m.dateHeader !== undefined ? [{ name: "Date", value: m.dateHeader }] : []),
            { name: "Subject", value: "Test" },
          ],
          body: { size: 0 },
        },
      })),
    } as RawGmailThread;
  }

  it("derives receivedAt from internalDate, not the Date header", () => {
    const serverTime = new Date("2026-06-03T17:32:00Z").getTime();
    // Sender claims a wildly different (future) send time in the Date header.
    const raw = timestampThread([
      { id: "msg-1", internalDate: String(serverTime), dateHeader: "Fri, 01 Jan 2100 00:00:00 +0000" },
    ]);
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.receivedAt.getTime()).toBe(serverTime);
    expect(snapshot.latestMessageAt.getTime()).toBe(serverTime);
  });

  it("does not sink to epoch 0 when the Date header is missing", () => {
    const serverTime = new Date("2026-06-03T17:32:00Z").getTime();
    const raw = timestampThread([{ id: "msg-1", internalDate: String(serverTime) }]);
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.receivedAt.getTime()).toBe(serverTime);
  });

  it("does not sink to epoch 0 when the Date header is unparseable", () => {
    const serverTime = new Date("2026-06-03T17:32:00Z").getTime();
    const raw = timestampThread([
      { id: "msg-1", internalDate: String(serverTime), dateHeader: "not a real date" },
    ]);
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.receivedAt.getTime()).toBe(serverTime);
  });

  it("falls back to epoch 0 only when internalDate itself is absent", () => {
    const raw = timestampThread([{ id: "msg-1", dateHeader: "Wed, 03 Jun 2026 17:32:00 +0000" }]);
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.receivedAt.getTime()).toBe(0);
  });

  it("orders latestMessageAt by server internalDate, ignoring a forged future Date header", () => {
    const older = new Date("2026-06-03T17:32:00Z").getTime();
    const newer = new Date("2026-06-04T09:00:00Z").getTime();
    const raw = timestampThread([
      // Newest by server time, but claims an ancient send time.
      { id: "msg-2", internalDate: String(newer), dateHeader: "Thu, 01 Jan 1970 00:00:00 +0000" },
      // Oldest by server time, but forges a far-future send time.
      { id: "msg-1", internalDate: String(older), dateHeader: "Fri, 01 Jan 2100 00:00:00 +0000" },
    ]);
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.latestMessageAt.getTime()).toBe(newer);
  });
});

describe("normalizeGmailThread body text", () => {
  it("strips [cid:...] placeholder markers from the plain-text body", () => {
    const raw = thread({
      mimeType: "multipart/mixed",
      parts: [plainPart("Thank you!\n[cid:c3d8cbe3-8683-4b6d-840d-b3a17b213b71]")],
    });
    const snapshot = normalizeGmailThread(raw);
    expect(snapshot.messages[0]!.bodyExcerpt).not.toContain("cid:");
    expect(snapshot.messages[0]!.bodyExcerpt).toContain("Thank you!");
  });
});
