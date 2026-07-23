import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("./encryption.js", () => ({
  decrypt: vi.fn().mockReturnValue("plain-refresh-token"),
  encrypt: vi.fn().mockReturnValue("encrypted:token:value"),
}));

import {
  revokeGoogleToken,
  GmailClient,
  GmailAuthError,
  GmailThreadNotFoundError,
} from "./gmail-client.js";
import { decrypt } from "./encryption.js";

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STOP_URL = "https://gmail.googleapis.com/gmail/v1/users/me/stop";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decrypt).mockReturnValue("plain-refresh-token");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── revokeGoogleToken ────────────────────────────────────────────────────────

describe("revokeGoogleToken", () => {
  it("returns true when Google responds 200", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      REVOKE_URL,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("posts the token as form-encoded body", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await revokeGoogleToken("encrypted:token:value");

    const body = (mockFetch.mock.calls[0]?.[1] as RequestInit)?.body;
    expect(body?.toString()).toBe("token=plain-refresh-token");
  });

  it("returns true when Google responds 400 (token already invalid)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(true);
  });

  it("returns false when Google responds with a server error (500)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(false);
  });

  it("returns false when the fetch throws (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    expect(await revokeGoogleToken("encrypted:token:value")).toBe(false);
  });

  it("returns false when decryption fails", async () => {
    vi.mocked(decrypt).mockImplementationOnce(() => {
      throw new Error("bad key");
    });

    expect(await revokeGoogleToken("bad-token")).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns false when decryption returns an empty string", async () => {
    vi.mocked(decrypt).mockReturnValueOnce("");

    expect(await revokeGoogleToken("empty-token")).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── GmailClient.stopWatch ────────────────────────────────────────────────────

function makeTokenResponse() {
  return {
    ok: true,
    json: async () => ({
      access_token: "access-abc",
      expires_in: 3600,
      token_type: "Bearer",
    }),
  };
}

describe("GmailClient.stopWatch", () => {
  it("POSTs to the stop endpoint with a Bearer token", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.stopWatch()).resolves.toBeUndefined();

    const [stopUrl, stopInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(stopUrl).toBe(STOP_URL);
    expect(stopInit.method).toBe("POST");
    expect((stopInit.headers as Record<string, string>)?.["Authorization"]).toBe(
      "Bearer access-abc"
    );
  });

  it("first refreshes the access token before calling the stop endpoint", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const client = new GmailClient("encrypted:refresh:token");
    await client.stopWatch();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch.mock.calls[0] as [string])[0]).toBe(TOKEN_URL);
    expect((mockFetch.mock.calls[1] as [string])[0]).toBe(STOP_URL);
  });

  it("throws when the stop endpoint responds non-200", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 403 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.stopWatch()).rejects.toThrow("403");
  });
});

// ─── GmailClient.refreshAccessToken ───────────────────────────────────────────
// All refresh tokens are minted against the confidential Web client, so refresh
// always sends id + secret. invalid_grant / 401 (revoked or rejected) map to
// GmailAuthError, which the worker treats as a disconnect.

describe("GmailClient.refreshAccessToken", () => {
  function refreshBody(): URLSearchParams {
    const body = (mockFetch.mock.calls[0]?.[1] as RequestInit)?.body;
    return new URLSearchParams(body?.toString() ?? "");
  }

  it("refreshes with the confidential Web client (id + secret)", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "web-client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "web-secret");
    mockFetch.mockResolvedValueOnce(makeTokenResponse());

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.refreshAccessToken()).resolves.toBe("access-abc");

    const params = refreshBody();
    expect(params.get("client_id")).toBe("web-client-id");
    expect(params.get("client_secret")).toBe("web-secret");
    expect(params.get("grant_type")).toBe("refresh_token");
  });

  it("throws GmailAuthError on invalid_grant", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.refreshAccessToken()).rejects.toThrow(GmailAuthError);
  });

  it("throws GmailAuthError on a 401 (e.g. unauthorized_client)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized_client" }),
    });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.refreshAccessToken()).rejects.toThrow(GmailAuthError);
  });
});

// ─── GmailClient.listThreadsPage ──────────────────────────────────────────────

describe("GmailClient.listThreadsPage", () => {
  function listUrl(): URL {
    // calls[0] is the token refresh; calls[1] is the threads.list request.
    return new URL((mockFetch.mock.calls[1] as [string])[0]);
  }

  it("clamps a full-history scan (afterMs 0) to after:1, never the broken after:0", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [], resultSizeEstimate: 0 }) });

    const client = new GmailClient("encrypted:refresh:token");
    await client.listThreadsPage({ afterMs: 0, pageSize: 100 });

    // Gmail returns nothing for after:0, so a full-history scan must use after:1.
    expect(listUrl().searchParams.get("q")).toBe("after:1");
  });

  it("uses the real timestamp for a windowed scan", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [], resultSizeEstimate: 0 }) });

    const client = new GmailClient("encrypted:refresh:token");
    await client.listThreadsPage({ afterMs: 1_700_000_000_000, pageSize: 100 });

    expect(listUrl().searchParams.get("q")).toBe("after:1700000000");
  });

  it("requests From/To/Cc headers and parses per-message senders + recipients", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ threads: [{ id: "t1" }], resultSizeEstimate: 1 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            {
              labelIds: ["SENT"],
              internalDate: "1700000000000",
              payload: {
                headers: [
                  { name: "From", value: "Me <me@gmail.com>" },
                  { name: "To", value: "Them <them@corp.com>, other@corp.com" },
                  { name: "Cc", value: "cc@corp.com" },
                ],
              },
            },
          ],
        }),
      });

    const client = new GmailClient("encrypted:refresh:token");
    const { threads } = await client.listThreadsPage({ afterMs: 1_700_000_000_000, pageSize: 100 });

    // The metadata request asked for the identity headers.
    const metaUrl = new URL((mockFetch.mock.calls[2] as [string])[0]);
    expect(metaUrl.searchParams.getAll("metadataHeaders")).toEqual(["Date", "From", "To", "Cc"]);

    expect(threads[0]!.messageSenders).toEqual(["me@gmail.com"]);
    expect(threads[0]!.messageRecipients).toEqual([["them@corp.com", "other@corp.com", "cc@corp.com"]]);
    expect(threads[0]!.messageLabelIds).toEqual([["SENT"]]);
  });
});

// ─── GmailClient.getThread — deleted-thread detection ─────────────────────────
// A thread-specific 404 is the ONLY definitive "deleted" signal and maps to the
// typed GmailThreadNotFoundError the sync/classify/backfill loops skip on. Every
// other status stays a generic error so callers treat it as transient and retry.

describe("GmailClient.getThread — not-found mapping", () => {
  it("throws GmailThreadNotFoundError on a 404 for the requested thread", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.getThread("gone-thread")).rejects.toBeInstanceOf(
      GmailThreadNotFoundError
    );
  });

  it("throws a plain (transient) error on a 5xx, never the typed not-found", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const client = new GmailClient("encrypted:refresh:token");
    const err = await client.getThread("t-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailThreadNotFoundError);
  });
});

// ─── GmailClient.listChangesSince — sent-only candidates ──────────────────────
// A changed thread is a "sent-only candidate" only when its entire delta is
// outbound messagesAdded (SENT without INBOX). Any label mutation, any inbound
// message, or missing label data disqualifies it so it is fetched normally.

describe("GmailClient.listChangesSince — sent-only candidates", () => {
  function historyResponse(records: unknown[], historyId = "1002") {
    return { ok: true, status: 200, json: async () => ({ history: records, historyId }) };
  }

  it("flags a lone outbound messagesAdded as a candidate", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        historyResponse([{ messagesAdded: [{ message: { threadId: "t-sent", labelIds: ["SENT"] } }] }])
      );

    const client = new GmailClient("encrypted:refresh:token");
    const result = await client.listChangesSince("1000");
    expect(result.changedThreadIds).toContain("t-sent");
    expect(result.sentOnlyCandidateThreadIds).toEqual(["t-sent"]);
  });

  it("does NOT flag a note-to-self (SENT + INBOX)", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        historyResponse([{ messagesAdded: [{ message: { threadId: "t-self", labelIds: ["SENT", "INBOX"] } }] }])
      );

    const client = new GmailClient("encrypted:refresh:token");
    const result = await client.listChangesSince("1000");
    expect(result.changedThreadIds).toContain("t-self");
    expect(result.sentOnlyCandidateThreadIds).toEqual([]);
  });

  it("fails open when labelIds are missing on the added message", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        historyResponse([{ messagesAdded: [{ message: { threadId: "t-unknown" } }] }])
      );

    const client = new GmailClient("encrypted:refresh:token");
    const result = await client.listChangesSince("1000");
    expect(result.sentOnlyCandidateThreadIds).toEqual([]);
  });

  it("disqualifies a thread that also has a label change", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        historyResponse([
          { messagesAdded: [{ message: { threadId: "t-mixed", labelIds: ["SENT"] } }] },
          { labelsRemoved: [{ message: { threadId: "t-mixed" } }] },
        ])
      );

    const client = new GmailClient("encrypted:refresh:token");
    const result = await client.listChangesSince("1000");
    expect(result.changedThreadIds).toContain("t-mixed");
    expect(result.sentOnlyCandidateThreadIds).toEqual([]);
  });

  it("disqualifies across pages: outbound on page 1, inbound on page 2", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          history: [{ messagesAdded: [{ message: { threadId: "t-cross", labelIds: ["SENT"] } }] }],
          historyId: "1001",
          nextPageToken: "page2",
        }),
      })
      .mockResolvedValueOnce(
        historyResponse([{ messagesAdded: [{ message: { threadId: "t-cross", labelIds: ["INBOX"] } }] }])
      );

    const client = new GmailClient("encrypted:refresh:token");
    const result = await client.listChangesSince("1000");
    expect(result.changedThreadIds).toEqual(["t-cross"]);
    expect(result.sentOnlyCandidateThreadIds).toEqual([]);
  });
});

// ─── GmailClient.getAttachmentContent ─────────────────────────────────────────

describe("GmailClient.getAttachmentContent", () => {
  // base64url of the bytes [0x89,0x50,0x4e,0x47] (PNG signature) exercises the
  // url-safe alphabet (produces a "-" once re-encoded) and missing padding.
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const b64url = Buffer.from(pngBytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  it("fetches from the message attachment endpoint with a bearer token", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ size: 4, data: b64url }) });

    const client = new GmailClient("encrypted:refresh:token");
    const result = await client.getAttachmentContent("msg-1", "att-xyz");

    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-1/attachments/att-xyz"
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-abc");
    expect(Array.from(result.data)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(result.mimeType).toBeNull();
    expect(result.size).toBe(4);
  });

  it("url-encodes the message and attachment ids", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ size: 4, data: b64url }) });

    const client = new GmailClient("encrypted:refresh:token");
    await client.getAttachmentContent("msg/1", "att id");

    const [url] = mockFetch.mock.calls[1] as [string];
    expect(url).toContain("/messages/msg%2F1/attachments/att%20id");
  });

  it("throws when the attachment endpoint returns an error status", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.getAttachmentContent("msg-1", "att-gone")).rejects.toThrow();
  });

  it("throws when the response carries no data", async () => {
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ size: 0 }) });

    const client = new GmailClient("encrypted:refresh:token");
    await expect(client.getAttachmentContent("msg-1", "att-empty")).rejects.toThrow();
  });
});
