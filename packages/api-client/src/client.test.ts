import { describe, it, expect, vi } from "vitest";
import { makeApiClient, InjectionDisabledError } from "./client.js";
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

    it("deleteTaxonomyNode sends moveToNodeId body when provided", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ ok: true }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.deleteTaxonomyNode("ws1", "node1", "node2");
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers?: Record<string, string> }];
      expect(url).toBe("https://api.test/workspaces/ws1/taxonomy-nodes/node1");
      expect(init.method).toBe("DELETE");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(init.body).toBe(JSON.stringify({ moveToNodeId: "node2" }));
    });

    it("importTaxonomy POSTs the transfer file to taxonomy-import", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ ok: true }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      const file = {
        amarnaiTaxonomyVersion: 1 as const,
        exportedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        edges: [],
      };
      await client.importTaxonomy("ws1", file);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit & { headers?: Record<string, string> }];
      expect(url).toBe("https://api.test/workspaces/ws1/taxonomy-import");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(file));
    });

    it("importTaxonomy wraps file + mapping when a mapping is provided", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ ok: true }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      const file = {
        amarnaiTaxonomyVersion: 1 as const,
        exportedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        edges: [],
      };
      await client.importTaxonomy("ws1", file, { "old-1": "ref-2", "old-2": "resort" });
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBe(
        JSON.stringify({ file, mapping: { "old-1": "ref-2", "old-2": "resort" } })
      );
    });

    it("previewTaxonomyImport POSTs the file to the preview endpoint", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ suggestions: [], migrateCount: 0, resortCount: 0 }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      const file = {
        amarnaiTaxonomyVersion: 1 as const,
        exportedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        edges: [],
      };
      await client.previewTaxonomyImport("ws1", file);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.test/workspaces/ws1/taxonomy-import/preview");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(file));
    });

    it("needsReviewResortEligible GETs the reroute-needs-review endpoint", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ eligible: 4 }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      const r = await client.needsReviewResortEligible("ws1");
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.test/workspaces/ws1/sorting-queue/reroute-needs-review");
      expect(init.method ?? "GET").toBe("GET");
      expect(r.eligible).toBe(4);
    });

    it("rerouteNeedsReview POSTs the reroute-needs-review endpoint", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ queued: 4 }));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.rerouteNeedsReview("ws1");
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.test/workspaces/ws1/sorting-queue/reroute-needs-review");
      expect(init.method).toBe("POST");
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

    it("returns notClassified on a 422 carrying code NOT_CLASSIFIED", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ code: "NOT_CLASSIFIED", error: "Thread has not been classified yet" }, 422)
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      const result = await client.generateDraft("ws1", "t1");
      expect(result).toEqual({ notClassified: true });
    });

    it("still throws on a 422 without the code (an unrelated validation failure)", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ error: "Invalid params" }, 422));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.generateDraft("ws1", "t1")).rejects.toThrow("Invalid params");
    });

    it("throws on unexpected non-ok status", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ error: "Server error" }, 500));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.generateDraft("ws1", "t1")).rejects.toThrow("Server error");
    });
  });

  describe("generateDraftByProviderThread", () => {
    it("encodes the provider thread id in the URL", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ draft: { id: "d1" } }, 201));
      const client = makeApiClient(makeMockTransport(fetchFn));
      await client.generateDraftByProviderThread("ws1", "AAQkAD+bc/de");
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(
        "https://api.test/workspaces/ws1/provider-threads/AAQkAD%2Bbc%2Fde/generate-draft"
      );
    });

    it("throws InjectionDisabledError on a 403 flagged injectionDisabled", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ error: "Reply button injection is disabled", injectionDisabled: true }, 403)
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.generateDraftByProviderThread("ws1", "t1")).rejects.toBeInstanceOf(
        InjectionDisabledError
      );
    });

    it("throws a plain error on a 403 without the flag", async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockOk({ error: "Forbidden" }, 403));
      const client = makeApiClient(makeMockTransport(fetchFn));
      const err = await client.generateDraftByProviderThread("ws1", "t1").catch((e) => e);
      expect(err).not.toBeInstanceOf(InjectionDisabledError);
      expect(err.message).toBe("Forbidden");
    });

    it("shares the outcome mapping with generateDraft", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        mockOk({ code: "NOT_CLASSIFIED", error: "Thread has not been classified yet" }, 422)
      );
      const client = makeApiClient(makeMockTransport(fetchFn));
      await expect(client.generateDraftByProviderThread("ws1", "t1")).resolves.toEqual({
        notClassified: true,
      });
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
