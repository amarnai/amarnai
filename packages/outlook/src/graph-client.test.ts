import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// decrypt is a pass-through in tests; the error classes are real so `instanceof`
// and `throw` behave. These are the classes @aziru/mail re-exports as
// MailAuthError / MailCursorExpiredError.
vi.mock("@aziru/gmail", () => ({
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
} from "@aziru/gmail";

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
  it("returns the address and initial delta cursors for BOTH tracked folders", async () => {
    routeGraph((url) => {
      if (url.includes("/me?")) return jsonResponse({ mail: "User@Outlook.com" });
      if (url.includes("inbox/messages/delta"))
        return jsonResponse({ value: [], "@odata.deltaLink": "inbox-delta" });
      if (url.includes("sentitems/messages/delta"))
        return jsonResponse({ value: [], "@odata.deltaLink": "sent-delta" });
      throw new Error(`unexpected url ${url}`);
    });
    const profile = await client().getProfile();
    expect(profile.emailAddress).toBe("user@outlook.com");
    // Sent Items must be seeded at connect time too, or the first reply the user
    // sends would be missed until some later sync established the cursor.
    expect(JSON.parse(profile.syncCursor)).toEqual({ inbox: "inbox-delta", sent: "sent-delta" });
  });

  // Consumer outlook.com mailboxes ignore `$deltatoken=latest` and enumerate the
  // folder in pages; the cursor only appears on the terminal page.
  it("follows nextLink pages until the deltaLink when $deltatoken=latest is not honored", async () => {
    routeGraph((url) => {
      if (url.includes("/me?")) return jsonResponse({ mail: "user@outlook.com" });
      if (url.includes("sentitems/messages/delta"))
        return jsonResponse({ value: [], "@odata.deltaLink": "sent-delta" });
      if (url.includes("deltatoken=latest"))
        return jsonResponse({ value: [{ id: "m1" }], "@odata.nextLink": "https://graph/delta?page=2" });
      if (url.includes("page=2"))
        return jsonResponse({ value: [{ id: "m2" }], "@odata.deltaLink": "https://graph/delta?$deltatoken=real" });
      throw new Error(`unexpected url ${url}`);
    });
    const profile = await client().getProfile();
    expect(JSON.parse(profile.syncCursor).inbox).toBe("https://graph/delta?$deltatoken=real");
  });

  // Persisting "" as a cursor is indistinguishable from "no cursor" and would
  // silently disable incremental sync forever — a dead-end chain must throw.
  it("throws when the delta chain ends without a deltaLink", async () => {
    routeGraph((url) => {
      if (url.includes("/me?")) return jsonResponse({ mail: "user@outlook.com" });
      if (url.includes("/messages/delta")) return jsonResponse({ value: [] });
      throw new Error(`unexpected url ${url}`);
    });
    await expect(client().getProfile()).rejects.toThrow(/without a deltaLink/);
  });
});

// ─── listChangesSince ─────────────────────────────────────────────────────────

describe("GraphClient.listChangesSince", () => {
  /** The "point Sent Items at now" request, issued when no sent cursor is stored. */
  const isSentEstablish = (url: string) =>
    url.includes("sentitems/messages/delta") && url.includes("deltatoken=latest");

  /** Both cursors are carried in one opaque value; tests assert on the parts. */
  const parts = (cursor: string) => JSON.parse(cursor) as { inbox: string; sent?: string };

  /** A compound cursor as it is stored once Sent Items is tracked. */
  const compound = (inbox: string, sent: string) => JSON.stringify({ inbox, sent });

  it("pages nextLink until the deltaLink and dedups conversation ids", async () => {
    routeGraph((url) => {
      if (url === "inbox-0")
        return jsonResponse({
          value: [{ id: "m1", conversationId: "c1" }, { id: "m2", conversationId: "c1" }],
          "@odata.nextLink": "inbox-1",
        });
      if (url === "inbox-1")
        return jsonResponse({
          value: [{ id: "m3", conversationId: "c2" }],
          "@odata.deltaLink": "inbox-next",
        });
      if (url === "sent-0") return jsonResponse({ value: [], "@odata.deltaLink": "sent-next" });
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince(compound("inbox-0", "sent-0"));
    expect(res.changedThreadIds.sort()).toEqual(["c1", "c2"]);
    expect(res.removedMessageIds).toEqual([]);
    expect(parts(res.newCursor)).toEqual({ inbox: "inbox-next", sent: "sent-next" });
  });

  it("collects @removed message ids (archive/delete/move-out) apart from changed conversations", async () => {
    // A message archived / deleted / moved out of a tracked folder surfaces as an
    // `@removed` tombstone carrying only its id — no conversationId — so it must
    // be reported separately for the worker to resolve its thread and re-sort it.
    routeGraph((url) => {
      if (url === "inbox-0")
        return jsonResponse({
          value: [
            { id: "m1", conversationId: "c1" },
            { id: "m-removed", "@removed": { reason: "deleted" } },
          ],
          "@odata.deltaLink": "inbox-next",
        });
      if (url === "sent-0")
        return jsonResponse({
          // The user deleted their own sent copy.
          value: [{ id: "m-sent-removed", "@removed": { reason: "deleted" } }],
          "@odata.deltaLink": "sent-next",
        });
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince(compound("inbox-0", "sent-0"));
    expect(res.changedThreadIds).toEqual(["c1"]);
    expect(res.removedMessageIds.sort()).toEqual(["m-removed", "m-sent-removed"]);
  });

  // ── Sent Items as a change signal ───────────────────────────────────────────

  it("reports a conversation seen only in Sent Items as changed AND as a sent-only candidate", async () => {
    // The gap this closes: replying from Outlook writes to Sent Items and never
    // touches the inbox, so without this the thread never re-syncs and the reply
    // is never persisted. Flagged as a candidate so the worker skips it when it
    // was never imported (a new email awaiting a reply) but still processes it
    // when it was (a reply to an existing thread).
    routeGraph((url) => {
      if (url === "inbox-0") return jsonResponse({ value: [], "@odata.deltaLink": "inbox-next" });
      if (url === "sent-0")
        return jsonResponse({
          value: [{ id: "s1", conversationId: "c-reply" }],
          "@odata.deltaLink": "sent-next",
        });
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince(compound("inbox-0", "sent-0"));
    expect(res.changedThreadIds).toEqual(["c-reply"]);
    expect(res.sentOnlyCandidateThreadIds).toEqual(["c-reply"]);
  });

  it("does not flag a conversation as sent-only when the inbox also saw it", async () => {
    // Inbound message plus the user's reply in the same cycle: real two-sided
    // activity, so it must be fetched, not skipped.
    routeGraph((url) => {
      if (url === "inbox-0")
        return jsonResponse({
          value: [{ id: "m1", conversationId: "c-both" }],
          "@odata.deltaLink": "inbox-next",
        });
      if (url === "sent-0")
        return jsonResponse({
          value: [{ id: "s1", conversationId: "c-both" }],
          "@odata.deltaLink": "sent-next",
        });
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince(compound("inbox-0", "sent-0"));
    expect(res.changedThreadIds).toEqual(["c-both"]);
    expect(res.sentOnlyCandidateThreadIds).toEqual([]);
  });

  it("upgrades a legacy inbox-only cursor by adopting Sent Items at 'now', scanning nothing", async () => {
    // Cursors stored before Sent Items was tracked are a bare deltaLink. Walking
    // Sent Items from the beginning would report every thread the user has ever
    // replied to as changed in one sync, so the upgrade is non-retroactive.
    let sentWalks = 0;
    routeGraph((url) => {
      if (url === "legacy-inbox-cursor")
        return jsonResponse({
          value: [{ id: "m1", conversationId: "c1" }],
          "@odata.deltaLink": "inbox-next",
        });
      if (isSentEstablish(url)) return jsonResponse({ value: [], "@odata.deltaLink": "sent-fresh" });
      sentWalks++;
      throw new Error(`unexpected url ${url}`);
    });
    const res = await client().listChangesSince("legacy-inbox-cursor");
    expect(res.changedThreadIds).toEqual(["c1"]);
    expect(res.sentOnlyCandidateThreadIds).toEqual([]);
    expect(parts(res.newCursor)).toEqual({ inbox: "inbox-next", sent: "sent-fresh" });
    expect(sentWalks).toBe(0);
  });

  it("maps a 410 Gone to MailCursorExpiredError", async () => {
    routeGraph(() => jsonResponse({ error: { code: "syncStateNotFound" } }, { status: 410 }));
    await expect(client().listChangesSince("stale")).rejects.toBeInstanceOf(
      GmailHistoryCursorExpiredError,
    );
  });

  it("sends the immutable-id Prefer header on delta requests", async () => {
    routeGraph(() => jsonResponse({ value: [], "@odata.deltaLink": "next" }));
    await client().listChangesSince(compound("inbox-0", "sent-0"));
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
  const INBOX_ID = "folder-inbox";
  const SENT_ID = "folder-sent";

  /** A message in the inbox folder, oldest-first friendly. */
  function inboxMsg(overrides: Record<string, unknown> = {}) {
    return {
      id: "m1",
      conversationId: "conv-1",
      parentFolderId: INBOX_ID,
      from: { emailAddress: { address: "a@x.com" } },
      subject: "Hi",
      receivedDateTime: "2026-06-01T10:00:00Z",
      body: { contentType: "text", content: "hello" },
      webLink: "wl-1",
      ...overrides,
    };
  }

  /**
   * Routes the two well-known folder lookups to fixed ids and the mailbox-wide
   * message query to `messages`. `onMessagesUrl` sees the message query's URL.
   */
  function routeSnapshot(
    messages: Array<Record<string, unknown>>,
    onMessagesUrl?: (url: string) => void,
  ): { folderLookups: number; messageQueries: number } {
    const counts = { folderLookups: 0, messageQueries: 0 };
    routeGraph((url) => {
      if (url.includes("/me/mailFolders/inbox?")) {
        counts.folderLookups++;
        return jsonResponse({ id: INBOX_ID });
      }
      if (url.includes("/me/mailFolders/sentitems?")) {
        counts.folderLookups++;
        return jsonResponse({ id: SENT_ID });
      }
      counts.messageQueries++;
      onMessagesUrl?.(url);
      return jsonResponse({ value: messages });
    });
    return counts;
  }

  it("queries the mailbox (not the inbox folder) and normalizes the conversation", async () => {
    let seen = "";
    routeSnapshot([inboxMsg()], (url) => {
      seen = url;
    });
    const snap = await client().getThreadSnapshot("conv-1");

    // Mailbox-wide: Sent Items lives outside the inbox, so an inbox-scoped query
    // would never see the owner's own replies.
    expect(seen).toContain("/me/messages?");
    expect(seen).not.toContain("mailFolders/inbox/messages");
    expect(seen).toContain("conversationId");
    expect(seen).toContain("conv-1");
    expect(seen).toContain("internetMessageHeaders");
    // parentFolderId/isDraft drive the folder partition and must be selected.
    expect(seen).toContain("parentFolderId");
    expect(seen).toContain("isDraft");
    // Attachment ids must be selected so inline images are fetchable later.
    expect(decodeURIComponent(seen)).toContain(
      "attachments($select=id,name,contentType,size,isInline)",
    );

    expect(snap.provider).toBe("outlook");
    expect(snap.providerThreadId).toBe("conv-1");
    expect(snap.messageCount).toBe(1);
    expect(snap.webLink).toBe("wl-1");
  });

  it("includes the owner's own replies from Sent Items", async () => {
    routeSnapshot([
      inboxMsg({ id: "in-1", receivedDateTime: "2026-06-01T10:00:00Z" }),
      inboxMsg({
        id: "sent-1",
        parentFolderId: SENT_ID,
        from: { emailAddress: { address: "me@x.com" } },
        receivedDateTime: undefined,
        sentDateTime: "2026-06-01T12:00:00Z",
      }),
    ]);
    const snap = await client().getThreadSnapshot("conv-1");

    expect(snap.messages.map((m) => m.providerMessageId)).toEqual(["in-1", "sent-1"]);
    expect(snap.messageCount).toBe(2);
    // The reply moves the thread's clock, matching Gmail. sentDateTime stands in
    // for the missing receivedDateTime, so the reply never sorts to the epoch.
    expect(snap.latestMessageAt.toISOString()).toBe("2026-06-01T12:00:00.000Z");
    expect(snap.participants).toContain("me@x.com");
  });

  it("drops drafts, junk, trash and archived copies the mailbox-wide query now returns", async () => {
    routeSnapshot([
      inboxMsg({ id: "keep" }),
      // Unsent draft: never part of the conversation, matched on isDraft as well
      // as on its folder.
      inboxMsg({ id: "draft-in-drafts", parentFolderId: "folder-drafts", isDraft: true }),
      inboxMsg({ id: "draft-elsewhere", parentFolderId: SENT_ID, isDraft: true }),
      inboxMsg({ id: "junk", parentFolderId: "folder-junk" }),
      inboxMsg({ id: "trash", parentFolderId: "folder-deleted" }),
      // Archived / filed into a user folder: this is a REMOVAL, so it must not
      // come back through the widened query.
      inboxMsg({ id: "archived", parentFolderId: "folder-archive" }),
      inboxMsg({ id: "filed", parentFolderId: "folder-clients" }),
    ]);
    const snap = await client().getThreadSnapshot("conv-1");
    expect(snap.messages.map((m) => m.providerMessageId)).toEqual(["keep"]);
  });

  it("maps an empty conversation (deleted, or fully gone from the inbox) to the typed MailThreadNotFoundError", async () => {
    // A filter query for a deleted/unknown conversationId returns 200 with an
    // empty value array. Graph never 404s per-conversation on this path, so the
    // empty set is the definitive gone signal the sync/classify loops skip on.
    routeSnapshot([]);
    await expect(client().getThreadSnapshot("gone")).rejects.toBeInstanceOf(
      GmailThreadNotFoundError,
    );
  });

  it("derives not-found from the INBOX partition alone, not the widened set", async () => {
    // Every inbound message archived, leaving only the owner's Sent Items copies.
    // The thread is gone from the inbox and must still read as not-found —
    // otherwise archiving a thread you replied to would stop registering.
    routeSnapshot([
      inboxMsg({
        id: "sent-1",
        parentFolderId: SENT_ID,
        from: { emailAddress: { address: "me@x.com" } },
      }),
      inboxMsg({ id: "archived", parentFolderId: "folder-archive" }),
    ]);
    await expect(client().getThreadSnapshot("conv-1")).rejects.toBeInstanceOf(
      GmailThreadNotFoundError,
    );
  });

  it("resolves the well-known folder ids once per client, not once per thread", async () => {
    // The snapshot path runs thousands of times during a historical backfill; the
    // folder lookups must not scale with it.
    const counts = routeSnapshot([inboxMsg()]);
    const c = client();
    await c.getThreadSnapshot("conv-1");
    await c.getThreadSnapshot("conv-2");
    await c.getThreadSnapshot("conv-3");
    expect(counts.folderLookups).toBe(2); // inbox + sentitems
    expect(counts.messageQueries).toBe(3); // one per thread, same as before
  });

  it("does not cache a failed folder resolution", async () => {
    let failFolders = true;
    routeGraph((url) => {
      if (url.includes("/me/mailFolders/")) {
        if (failFolders) return jsonResponse({ error: { code: "ServiceUnavailable" } }, { status: 503 });
        return jsonResponse({ id: url.includes("sentitems") ? SENT_ID : INBOX_ID });
      }
      return jsonResponse({ value: [inboxMsg()] });
    });
    const c = client();
    await expect(c.getThreadSnapshot("conv-1")).rejects.toThrow();
    failFolders = false;
    await expect(c.getThreadSnapshot("conv-1")).resolves.toMatchObject({ messageCount: 1 });
  });

  it("does NOT map a 404 on the messages query itself to the typed not-found (mailbox-level failure, transient)", async () => {
    routeGraph((url) => {
      if (url.includes("/me/mailFolders/")) {
        return jsonResponse({ id: url.includes("sentitems") ? SENT_ID : INBOX_ID });
      }
      return jsonResponse({ error: { code: "MailboxNotEnabledForRESTAPI" } }, { status: 404 });
    });
    const err = await client().getThreadSnapshot("conv-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailThreadNotFoundError);
  });
});

// ─── getAttachmentContent ─────────────────────────────────────────────────────

describe("GraphClient.getAttachmentContent", () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG signature
  const contentBytes = Buffer.from(bytes).toString("base64");

  it("fetches a fileAttachment and decodes its contentBytes", async () => {
    routeGraph((url) => {
      expect(url).toContain("/me/messages/m1/attachments/att-1");
      return jsonResponse({ contentBytes, contentType: "image/jpeg", size: 4 });
    });
    const result = await client().getAttachmentContent("m1", "att-1");
    expect(Array.from(result.data)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.size).toBe(4);
  });

  it("url-encodes the message and attachment ids", async () => {
    let seen = "";
    routeGraph((url) => {
      seen = url;
      return jsonResponse({ contentBytes, contentType: "image/jpeg", size: 4 });
    });
    await client().getAttachmentContent("m/1", "att 1");
    expect(seen).toContain("/me/messages/m%2F1/attachments/att%201");
  });

  it("throws when the attachment has no contentBytes (item/reference attachment)", async () => {
    routeGraph(() => jsonResponse({ contentType: "image/jpeg", size: 4 }));
    await expect(client().getAttachmentContent("m1", "att-1")).rejects.toThrow();
  });

  it("maps a 401 to the typed auth error", async () => {
    routeGraph(() => jsonResponse({ error: { code: "InvalidAuthenticationToken" } }, { status: 401 }));
    await expect(client().getAttachmentContent("m1", "att-1")).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("throws a generic error on other non-OK statuses", async () => {
    routeGraph(() => jsonResponse({ error: { code: "ErrorItemNotFound" } }, { status: 404 }));
    const err = await client().getAttachmentContent("m1", "gone").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailAuthError);
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

// ─── 401 on a data request (rejected access token) ────────────────────────────

describe("GraphClient 401 handling", () => {
  it("classifies a data-request 401 as MailAuthError (not a transient error)", async () => {
    routeGraph(() => jsonResponse({ error: { code: "InvalidAuthenticationToken" } }, { status: 401 }));
    await expect(client().listChangesSince("cursor-0")).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("surfaces the WWW-Authenticate challenge and error body in the message", async () => {
    routeGraph(() =>
      jsonResponse(
        { error: { code: "InvalidAuthenticationToken", message: "CAE challenge" } },
        {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer error="insufficient_claims", claims="abc"' },
        },
      ),
    );
    const err = await client().listChangesSince("cursor-0").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailAuthError);
    const message = (err as Error).message;
    expect(message).toContain("401");
    expect(message).toContain("insufficient_claims");
    expect(message).toContain("InvalidAuthenticationToken");
  });

  it("classifies a 401 on the getProfile /me fetch as MailAuthError", async () => {
    routeGraph((url) => {
      if (url.includes("/me?")) return jsonResponse({ error: { code: "invalid" } }, { status: 401 });
      return jsonResponse({ value: [], "@odata.deltaLink": "next" });
    });
    await expect(client().getProfile()).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("still classifies a non-401 failure (e.g. 500) as a generic transient error", async () => {
    routeGraph(() => jsonResponse({ error: { code: "InternalServerError" } }, { status: 500 }));
    const err = await client().listChangesSince("cursor-0").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailAuthError);
    expect((err as Error).message).toContain("500");
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

    const promise = client().listChangesSince(JSON.stringify({ inbox: "inbox-0", sent: "sent-0" }));
    await vi.advanceTimersByTimeAsync(1000);
    const res = await promise;
    expect(JSON.parse(res.newCursor).inbox).toBe("next");
    // Throttled inbox call, its retry, then the Sent Items walk.
    expect(graphCalls).toBe(3);
    vi.useRealTimers();
  });
});

// ─── ensureFolderLabels (master categories) ───────────────────────────────────

describe("GraphClient.ensureFolderLabels", () => {
  it("creates a flat category per folder using the joined path as the display name", async () => {
    const created: unknown[] = [];
    routeGraph((url, init) => {
      if (url.includes("/masterCategories") && init?.method === "POST") {
        created.push(JSON.parse(init.body as string));
        return jsonResponse({});
      }
      if (url.includes("/masterCategories")) return jsonResponse({ value: [] }); // list: none exist
      return jsonResponse({}, { status: 404 });
    });

    const map = await client().ensureFolderLabels([
      { nodeId: "n1", pathSegments: ["Aziru", "Clients", "Acme"], colorKey: "blue" },
    ]);

    // Identifier is the literal joined display name (categories are flat).
    expect(map.get("n1")).toBe("Aziru/Clients/Acme");
    expect(created).toEqual([{ displayName: "Aziru/Clients/Acme", color: "preset7" }]);
  });

  it("reuses an existing category (case-insensitive) without recreating it", async () => {
    let posts = 0;
    routeGraph((url, init) => {
      if (url.includes("/masterCategories") && init?.method === "POST") {
        posts++;
        return jsonResponse({});
      }
      if (url.includes("/masterCategories")) {
        return jsonResponse({ value: [{ displayName: "aziru/clients" }] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const map = await client().ensureFolderLabels([
      { nodeId: "n1", pathSegments: ["Aziru", "Clients"], colorKey: "red" },
    ]);

    expect(map.get("n1")).toBe("aziru/clients"); // canonical existing name
    expect(posts).toBe(0);
  });
});

// ─── applyThreadFolderLabels (per-message categories) ─────────────────────────

describe("GraphClient.applyThreadFolderLabels", () => {
  it("adds the desired category while preserving the user's own, via read-modify-write", async () => {
    const patched: Record<string, string[]> = {};
    routeGraph((url, init) => {
      const m = url.match(/\/messages\/([^?]+)/);
      const id = m ? decodeURIComponent(m[1]!) : "";
      if (init?.method === "PATCH") {
        patched[id] = (JSON.parse(init.body as string) as { categories: string[] }).categories;
        return jsonResponse({});
      }
      // GET categories
      return jsonResponse({ categories: ["Work", "Aziru/Old"] });
    });

    await client().applyThreadFolderLabels({
      threadId: "conv-1",
      messageIds: ["m-1"],
      desiredLabelIds: ["Aziru/New"],
      managedLabelIds: ["Aziru/Old", "Aziru/New"],
    });

    // "Work" (foreign) kept, "Aziru/Old" (managed, undesired) dropped, "Aziru/New" added.
    expect(patched["m-1"]).toEqual(["Work", "Aziru/New"]);
  });

  it("makes no PATCH when the message already matches", async () => {
    let patches = 0;
    routeGraph((url, init) => {
      if (init?.method === "PATCH") {
        patches++;
        return jsonResponse({});
      }
      return jsonResponse({ categories: ["Aziru/New"] });
    });

    await client().applyThreadFolderLabels({
      threadId: "conv-1",
      messageIds: ["m-1"],
      desiredLabelIds: ["Aziru/New"],
      managedLabelIds: ["Aziru/New"],
    });

    expect(patches).toBe(0);
  });

  it("skips a message that is gone (404) and continues with the rest", async () => {
    const patched: string[] = [];
    routeGraph((url, init) => {
      const gone = url.includes("m-gone");
      if (init?.method === "PATCH") {
        patched.push("patched");
        return jsonResponse({});
      }
      if (gone) return jsonResponse({}, { status: 404 });
      return jsonResponse({ categories: [] });
    });

    await client().applyThreadFolderLabels({
      threadId: "conv-1",
      messageIds: ["m-gone", "m-ok"],
      desiredLabelIds: ["Aziru/New"],
      managedLabelIds: ["Aziru/New"],
    });

    // Only the reachable message was patched.
    expect(patched).toEqual(["patched"]);
  });
});
