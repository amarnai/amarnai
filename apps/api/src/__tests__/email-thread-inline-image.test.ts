import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    emailThread: {
      findFirst: vi.fn(),
    },
    emailMessage: {
      findFirst: vi.fn(),
    },
    emailConnection: {
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@amarnai/mail", () => ({
  createMailProvider: vi.fn(),
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { createMailProvider } from "@amarnai/mail";

const WS_ID = "ws-1";
const THREAD_ID = "thread-1";
const MSG_ID = "msg-1";
const PROVIDER_MSG_ID = "gmail-msg-1";

// A 12-byte buffer whose first bytes are the PNG signature (sniff needs ≥12 bytes).
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const BASE_CONNECTION = { provider: "GMAIL", encryptedRefreshToken: "enc" };

function mockProvider(overrides: Record<string, unknown> = {}) {
  const provider = {
    getThreadSnapshot: vi.fn(),
    getAttachmentContent: vi.fn(),
    ...overrides,
  };
  vi.mocked(createMailProvider).mockReturnValue(provider as never);
  return provider;
}

function urlFor(attachmentId: string): string {
  return (
    `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/messages/${MSG_ID}` +
    `/inline-image?attachmentId=${encodeURIComponent(attachmentId)}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
});

describe("GET .../messages/:messageId/inline-image", () => {
  it("streams sniffed image bytes with cache + nosniff headers on the happy path", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue({ providerMessageId: PROVIDER_MSG_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
    const provider = mockProvider();
    provider.getAttachmentContent.mockResolvedValue({ data: PNG_BYTES, mimeType: null, size: PNG_BYTES.byteLength });

    const res = await app.request(urlFor("att-1"), authed());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES));
    expect(provider.getAttachmentContent).toHaveBeenCalledWith(PROVIDER_MSG_ID, "att-1");
  });

  it("returns 404 and never calls the provider when the user is not a member", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
    const provider = mockProvider();

    const res = await app.request(urlFor("att-1"), authed());

    expect(res.status).toBe(404);
    expect(provider.getAttachmentContent).not.toHaveBeenCalled();
  });

  it("returns 404 and never calls the provider when the message is not in the thread/workspace", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue(null);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
    const provider = mockProvider();

    const res = await app.request(urlFor("att-1"), authed());

    expect(res.status).toBe(404);
    expect(provider.getAttachmentContent).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no email connection (mock inbox)", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue({ providerMessageId: PROVIDER_MSG_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);
    const provider = mockProvider();

    const res = await app.request(urlFor("att-1"), authed());

    expect(res.status).toBe(404);
    expect(provider.getAttachmentContent).not.toHaveBeenCalled();
  });

  it("returns 404 when the bytes are not a recognized image type", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue({ providerMessageId: PROVIDER_MSG_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
    const provider = mockProvider();
    // Starts with "<svg" — never matches a binary signature.
    const svg = new TextEncoder().encode("<svg xmlns=...>");
    provider.getAttachmentContent.mockResolvedValue({ data: svg, mimeType: "image/svg+xml", size: svg.byteLength });

    const res = await app.request(urlFor("att-1"), authed());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the attachment exceeds the size cap", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue({ providerMessageId: PROVIDER_MSG_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
    const provider = mockProvider();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    provider.getAttachmentContent.mockResolvedValue({ data: big, mimeType: null, size: big.byteLength });

    const res = await app.request(urlFor("att-1"), authed());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the provider throws", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue({ providerMessageId: PROVIDER_MSG_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
    const provider = mockProvider();
    provider.getAttachmentContent.mockRejectedValue(new Error("gmail down"));

    const res = await app.request(urlFor("att-1"), authed());
    expect(res.status).toBe(404);
  });

  it("returns 400 when attachmentId is missing", async () => {
    vi.mocked(db.emailMessage.findFirst).mockResolvedValue({ providerMessageId: PROVIDER_MSG_ID } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
    const provider = mockProvider();

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/messages/${MSG_ID}/inline-image`,
      authed()
    );
    expect(res.status).toBe(400);
    expect(provider.getAttachmentContent).not.toHaveBeenCalled();
  });
});

describe("GET .../bodies — inlineImages", () => {
  function snapshotMessage(inlineImages: unknown[]) {
    return {
      providerMessageId: PROVIDER_MSG_ID,
      bodyExcerpt: "hello",
      inlineImages,
    };
  }

  beforeEach(() => {
    vi.mocked(db.emailThread.findFirst).mockResolvedValue({
      providerThreadId: "provider-thread-1",
      messages: [{ id: MSG_ID, providerMessageId: PROVIDER_MSG_ID }],
    } as never);
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(BASE_CONNECTION as never);
  });

  it("returns filtered inline image descriptors keyed by DB message id", async () => {
    const provider = mockProvider();
    provider.getThreadSnapshot.mockResolvedValue({
      messages: [
        snapshotMessage([
          { attachmentId: "a-png", mimeType: "image/png", filename: "logo.png", size: 100 },
          { attachmentId: "a-svg", mimeType: "image/svg+xml", filename: "x.svg", size: 100 },
          { attachmentId: "a-big", mimeType: "image/jpeg", filename: "big.jpg", size: 6 * 1024 * 1024 },
        ]),
      ],
    });

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/bodies`,
      authed()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bodies: Record<string, string | null>;
      inlineImages: Record<string, Array<{ attachmentId: string }>>;
    };
    expect(body.bodies[MSG_ID]).toBe("hello");
    // SVG (disallowed type) and the oversize JPEG are filtered out.
    expect(body.inlineImages[MSG_ID]).toEqual([
      { attachmentId: "a-png", mimeType: "image/png", filename: "logo.png" },
    ]);
  });

  it("returns empty maps when there is no connection", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null);

    const res = await app.request(
      `/workspaces/${WS_ID}/email-threads/${THREAD_ID}/bodies`,
      authed()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bodies: object; inlineImages: object };
    expect(body.bodies).toEqual({});
    expect(body.inlineImages).toEqual({});
  });
});
