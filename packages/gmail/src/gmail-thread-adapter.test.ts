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
