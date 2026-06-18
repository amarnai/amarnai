import { describe, it, expect, vi } from "vitest";
import { makeApiClient } from "./client.js";
import type { ApiTransport } from "./transport.js";

function mockOk(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function makeMockTransport(fetchFn: ApiTransport["fetch"]): ApiTransport {
  return { baseUrl: "https://api.test", fetch: fetchFn };
}

describe("makeApiClient", () => {
  describe("apiFetch helpers", () => {
    it("GET /workspaces calls the correct URL", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk([{ id: "ws1" }]));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.workspaces();
      expect(fetchFn).toHaveBeenCalledWith(
        "https://api.test/workspaces",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    it("passes revalidate hint when provided", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ counts: [], total: 0 }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.folderCounts("ws1");
      // folderCounts uses default apiFetch (no revalidate), so cache: no-store
      expect(fetchFn).toHaveBeenCalledWith(
        "https://api.test/workspaces/ws1/folder-counts",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    it("throws on non-ok response", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ error: "Not found" }, 404));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.workspaces()).rejects.toThrow("API /workspaces returned 404");
    });
  });

  describe("apiMutate helpers", () => {
    it("POST sends JSON body and Content-Type header", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ id: "node1" }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.createTaxonomyNode("ws1", { name: "My Node", description: "desc" });
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers?: Record<string, string> }];
      expect(url).toBe("https://api.test/workspaces/ws1/taxonomy-nodes");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(init.body).toBe(JSON.stringify({ name: "My Node", description: "desc" }));
    });

    it("DELETE without body omits Content-Type", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ ok: true }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.deleteTaxonomyNode("ws1", "node1");
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers?: Record<string, string> }];
      expect(init.method).toBe("DELETE");
      expect((init.headers as Record<string, string>)?.["Content-Type"]).toBeUndefined();
    });

    it("apiMutate throws with server error message", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ error: "Workspace not found" }, 400));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.sweepInbox("ws1")).rejects.toThrow("Workspace not found");
    });
  });

  describe("emailThreads", () => {
    it("builds query string from filters", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ threads: [], nextCursor: null, counts: {} })
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.emailThreads("ws1", { nodeId: "n1", status: "SORTED" });
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toContain("nodeId=n1");
      expect(url).toContain("status=SORTED");
    });

    it("omits query string when no filters", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ threads: [], nextCursor: null, counts: {} })
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.emailThreads("ws1");
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe("https://api.test/workspaces/ws1/email-threads");
    });
  });

  describe("generateDraft", () => {
    it("returns quotaExceeded shape on 429", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ used: 5, limit: 5, resetsAt: "2026-07-01T00:00:00Z" }, 429)
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      const result = await client.generateDraft("ws1", "t1");
      expect(result).toMatchObject({ quotaExceeded: true, used: 5, limit: 5 });
    });

    it("returns draft + isNew: true on 201", async () => {
      const draft = { id: "d1", subject: null, body: "Hello", status: "PROPOSED", createdAt: "2026-01-01T00:00:00Z" };
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ draft }, 201));
      const client = makeApiClient(makeMockTransport(fetchFn));
      const result = await client.generateDraft("ws1", "t1");
      expect(result).toMatchObject({ draft, isNew: true });
    });

    it("passes X-Force-Regenerate header when force: true", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ generating: true }, 202)
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.generateDraft("ws1", "t1", { force: true });
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers?: Record<string, string> }];
      expect((init.headers as Record<string, string>)?.["X-Force-Regenerate"]).toBe("1");
    });

    it("throws on unexpected non-ok status", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ error: "Server error" }, 500));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.generateDraft("ws1", "t1")).rejects.toThrow("Server error");
    });
  });

  describe("removeBlacklistedEmail", () => {
    it("encodes the email in the URL", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ includeSpam: false, includePromotions: false, sortingPaused: false, blacklistedSenderEmails: [] }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.removeBlacklistedEmail("ws1", "user+tag@example.com");
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toContain(encodeURIComponent("user+tag@example.com"));
    });
  });
});
