import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// decrypt is a pass-through in tests; the error classes are real so `instanceof`
// and `throw` behave. These are the classes @amarnai/mail re-exports as
// MailAuthError / MailCursorExpiredError.
vi.mock("@amarnai/gmail", () => ({
  decrypt: (v: string) => v,
  GmailAuthError: class GmailAuthError extends Error {},
  GmailHistoryCursorExpiredError: class GmailHistoryCursorExpiredError extends Error {},
  GmailThreadNotFoundError: class GmailThreadNotFoundError extends Error {},
}));

import { GraphClient } from "./graph-client.js";
import {
  GmailAuthError,
  GmailHistoryCursorExpiredError,
  GmailThreadNotFoundError,
} from "@amarnai/gmail";

// ─── fetch mock plumbing ──────────────────────────────────────────────────────

type FakeInit = { status?: number; headers?: Record<string, string> };

function jsonResponse(body: unknown, init: FakeInit = {}): Response {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const TOKEN_OK = jsonResponse({ access_token: "access-token", expires_in: 3600 });

let fetchMock: ReturnType<typeof vi.fn>;

function isToken(url: string): boolean {
  return url.includes("oauth2/v2.0/token");
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Routes token requests to a fixed OK response and graph GETs to `handler`. */
function routeGraph(handler: (url: string, init?: RequestInit) => Response) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (isToken(url)) return Promise.resolve(TOKEN_OK);
    return Promise.resolve(handler(url, init));
  });
}

const client = () => new GraphClient("enc-refresh-token");

// ─── refreshAccessToken ───────────────────────────────────────────────────────

describe("GraphClient.refreshAccessToken", () => {
  it("exchanges the refresh token for an access token", async () => {
    fetchMock.mockResolvedValue(TOKEN_OK);
    await expect(client().refreshAccessToken()).resolves.toBe("access-token");
  });

  it("throws MailAuthError (GmailAuthError) on invalid_grant", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, { status: 400 }));
    await expect(client().refreshAccessToken()).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("throws MailAuthError on a 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized_client" }, { status: 401 }));
    await expect(client().refreshAccessToken()).rejects.toBeInstanceOf(GmailAuthError);
  });
});

// ─── getProfile ───────────────────────────────────────────────────────────────

describe("GraphClient.getProfile", () => {
  it("returns the address and an initial delta cursor from $deltatoken=latest", async () => {
    routeGraph((url) => {
      if (url.includes("/me?")) return jsonResponse({ mail: "User@Outlook.com" });
      if (url.includes("/messages/delta"))
        return jsonResponse({ value: [], "@odata.deltaLink": "https://graph/delta?$deltatoken=abc" });
      throw new Error(`unexpected url ${url}`);
    });
    const profile = await client().getProfile();
    expect(profile.emailAddress).toBe("user@outlook.com");
    expect(profile.syncCursor).toBe("https://graph/delta?$deltatoken=abc");
  });
});

// ─── listChangesSince ─────────────────────────────────────────────────────────

describe("GraphClient.listChangesSince", () => {
  it("pages nextLink until the deltaLink and dedups conversation ids", async () => {
    routeGraph((url) => {
      if (url === "cursor-0")
        return jsonResponse({
          value: [{ id: "m1", conversationId: "c1" }, { id: "m2", conversationId: "c1" }],
          "@odata.nextLink": "cursor-1",
        });
      if (url === "cursor-1")
        return jsonResponse({
          value: [{ id: "m3", conversationId: "c2" }],
          "@odata.deltaLink": "cursor-next",
        });
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince("cursor-0");
    expect(res.changedThreadIds.sort()).toEqual(["c1", "c2"]);
    expect(res.removedMessageIds).toEqual([]);
    expect(res.newCursor).toBe("cursor-next");
  });

  it("collects @removed message ids (archive/delete/move-out) apart from changed conversations", async () => {
    // A message archived / deleted / moved out of the inbox surfaces as an
    // `@removed` tombstone carrying only its id — no conversationId — so it must
    // be reported separately for the worker to resolve its thread and re-sort it.
    routeGraph((url) => {
      if (url === "cursor-0")
        return jsonResponse({
          value: [
            { id: "m1", conversationId: "c1" },
            { id: "m-removed", "@removed": { reason: "deleted" } },
          ],
          "@odata.deltaLink": "cursor-next",
        });
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince("cursor-0");
    expect(res.changedThreadIds).toEqual(["c1"]);
    expect(res.removedMessageIds).toEqual(["m-removed"]);
    expect(res.newCursor).toBe("cursor-next");
  });

  it("maps a 410 Gone to MailCursorExpiredError", async () => {
    routeGraph(() => jsonResponse({ error: { code: "syncStateNotFound" } }, { status: 410 }));
    await expect(client().listChangesSince("stale")).rejects.toBeInstanceOf(
      GmailHistoryCursorExpiredError,
    );
  });

  it("sends the immutable-id Prefer header on delta requests", async () => {
    routeGraph(() => jsonResponse({ value: [], "@odata.deltaLink": "next" }));
    await client().listChangesSince("cursor-0");
    const graphCall = fetchMock.mock.calls.find(([u]) => !isToken(u as string));
    const headers = (graphCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Prefer"]).toBe('IdType="ImmutableId"');
  });
});

// ─── listThreadsPage ──────────────────────────────────────────────────────────

describe("GraphClient.listThreadsPage", () => {
  it("filters by receivedDateTime, groups by conversation, and returns the nextLink", async () => {
    routeGraph((url) => {
      expect(url).toContain("receivedDateTime");
      return jsonResponse({
        value: [
          { id: "m1", conversationId: "c1", receivedDateTime: "2026-06-01T10:00:00Z", isRead: false },
          { id: "m2", conversationId: "c1", receivedDateTime: "2026-06-02T10:00:00Z", isRead: true },
          { id: "m3", conversationId: "c2", receivedDateTime: "2026-06-03T10:00:00Z", isRead: true },
        ],
        "@odata.nextLink": "page-2",
      });
    });
    const page = await client().listThreadsPage({ afterMs: 0, pageSize: 50 });
    expect(page.threads).toHaveLength(2);
    const c1 = page.threads.find((t) => t.id === "c1")!;
    expect(c1.unread).toBe(true); // one message unread → thread unread
    expect(c1.latestMessageAt.toISOString()).toBe("2026-06-02T10:00:00.000Z");
    expect(page.nextPageToken).toBe("page-2");
  });

  it("resumes directly from a pageToken (Graph absolute nextLink)", async () => {
    const seen: string[] = [];
    routeGraph((url) => {
      seen.push(url);
      return jsonResponse({ value: [] });
    });
    await client().listThreadsPage({ afterMs: 0, pageToken: "https://graph/next?$skiptoken=xyz" });
    expect(seen).toContain("https://graph/next?$skiptoken=xyz");
  });
});

// ─── getThreadSnapshot ────────────────────────────────────────────────────────

describe("GraphClient.getThreadSnapshot", () => {
  it("fetches the conversation's INBOX messages and normalizes them", async () => {
    routeGraph((url) => {
      // Inbox-folder-scoped, not mailbox-wide: a message archived/moved out of
      // the inbox must drop out of the snapshot so removals register.
      expect(url).toContain("mailFolders/inbox/messages");
      expect(url).toContain("conversationId");
      expect(url).toContain("conv-1");
      expect(url).toContain("internetMessageHeaders");
      return jsonResponse({
        value: [
          {
            id: "m1",
            conversationId: "conv-1",
            from: { emailAddress: { address: "a@x.com" } },
            subject: "Hi",
            receivedDateTime: "2026-06-01T10:00:00Z",
            body: { contentType: "text", content: "hello" },
            webLink: "wl-1",
          },
        ],
      });
    });
    const snap = await client().getThreadSnapshot("conv-1");
    expect(snap.provider).toBe("outlook");
    expect(snap.providerThreadId).toBe("conv-1");
    expect(snap.messageCount).toBe(1);
    expect(snap.webLink).toBe("wl-1");
  });

  it("maps an empty conversation (deleted, or fully gone from the inbox) to the typed MailThreadNotFoundError", async () => {
    // A filter query for a deleted/unknown conversationId — or one whose messages
    // have ALL left the inbox (every message archived/moved out) — returns 200
    // with an empty value array. Graph never 404s per-conversation on this path,
    // so the empty set is the definitive gone-from-inbox signal the sync/classify
    // loops skip on.
    routeGraph(() => jsonResponse({ value: [] }));
    await expect(client().getThreadSnapshot("gone")).rejects.toBeInstanceOf(
      GmailThreadNotFoundError,
    );
  });

  it("does NOT map a 404 on the messages query itself to the typed not-found (mailbox-level failure, transient)", async () => {
    routeGraph(() =>
      jsonResponse({ error: { code: "MailboxNotEnabledForRESTAPI" } }, { status: 404 }),
    );
    const err = await client().getThreadSnapshot("conv-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailThreadNotFoundError);
  });
});

// ─── listRecentThreadIds ──────────────────────────────────────────────────────

describe("GraphClient.listRecentThreadIds", () => {
  it("returns unique conversation ids from recent inbox messages", async () => {
    routeGraph(() =>
      jsonResponse({
        value: [
          { id: "m1", conversationId: "c1" },
          { id: "m2", conversationId: "c1" },
          { id: "m3", conversationId: "c2" },
        ],
      }),
    );
    const ids = await client().listRecentThreadIds(10);
    expect(ids.sort()).toEqual(["c1", "c2"]);
  });
});

// ─── Retry-After (throttling) ─────────────────────────────────────────────────

describe("GraphClient throttling", () => {
  it("honors Retry-After once on a 429 then succeeds", async () => {
    vi.useFakeTimers();
    let graphCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (isToken(url)) return Promise.resolve(TOKEN_OK);
      graphCalls++;
      if (graphCalls === 1) return Promise.resolve(jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } }));
      return Promise.resolve(jsonResponse({ value: [], "@odata.deltaLink": "next" }));
    });

    const promise = client().listChangesSince("cursor-0");
    await vi.advanceTimersByTimeAsync(1000);
    const res = await promise;
    expect(res.newCursor).toBe("next");
    expect(graphCalls).toBe(2);
    vi.useRealTimers();
  });
});
