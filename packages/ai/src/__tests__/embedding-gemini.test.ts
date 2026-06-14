/**
 * Tests for GeminiEmbeddingProvider's HTTP error mapping.
 *
 * A retired/missing model returns HTTP 404 from the batchEmbedContents
 * endpoint. The provider must surface that as EmbeddingModelNotFoundError so
 * callers can fail fast instead of retrying a permanent misconfiguration.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  GeminiEmbeddingProvider,
  EmbeddingModelNotFoundError,
} from "../providers/embedding-gemini.js";

const provider = new GeminiEmbeddingProvider({
  apiKey: "test-key",
  model: "gemini-embedding-001",
});

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", fn as unknown as typeof fetch);
  return fn;
}

/** Parsed body of the most recent fetch call. */
function lastRequestBody(fn: ReturnType<typeof vi.fn>): { requests: unknown[] } {
  const init = fn.mock.calls[fn.mock.calls.length - 1]![1] as { body: string };
  return JSON.parse(init.body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiEmbeddingProvider", () => {
  it("throws EmbeddingModelNotFoundError on HTTP 404", async () => {
    mockFetch(404, {
      error: { code: 404, message: "models/text-embedding-004 is not found", status: "NOT_FOUND" },
    });

    await expect(provider.embed(["hello"])).rejects.toBeInstanceOf(
      EmbeddingModelNotFoundError,
    );
  });

  it("throws a generic error on other non-2xx statuses", async () => {
    mockFetch(429, { error: { code: 429, message: "rate limited" } });

    const err = await provider.embed(["hello"]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EmbeddingModelNotFoundError);
    expect((err as Error).message).toContain("429");
  });

  it("returns vectors on success", async () => {
    mockFetch(200, { embeddings: [{ values: [0.1, 0.2, 0.3] }] });

    const vectors = await provider.embed(["hello"]);
    expect(vectors).toEqual([[0.1, 0.2, 0.3]]);
  });

  it("returns an empty array without calling the API for no inputs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not send outputDimensionality when no dimension is configured", async () => {
    const fn = mockFetch(200, { embeddings: [{ values: [0.1, 0.2, 0.3] }] });

    await provider.embed(["hello"]);

    const body = lastRequestBody(fn);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).not.toHaveProperty("outputDimensionality");
    expect(provider.modelName).toBe("gemini-embedding-001");
  });

  it("sends outputDimensionality and folds it into modelName when configured", async () => {
    const dimProvider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      model: "gemini-embedding-001",
      dimensions: 768,
    });
    const fn = mockFetch(200, { embeddings: [{ values: [0.1, 0.2] }] });

    await dimProvider.embed(["hello"]);

    const body = lastRequestBody(fn);
    expect((body.requests[0] as { outputDimensionality?: number }).outputDimensionality).toBe(768);
    // Identity folds in the dimension so a change re-embeds stored vectors,
    // but the bare model name is still what hits the API URL.
    expect(dimProvider.modelName).toBe("gemini-embedding-001@768");
    const url = fn.mock.calls[0]![0] as string;
    expect(url).toContain("models/gemini-embedding-001:batchEmbedContents");
    expect(url).not.toContain("@768");
  });
});
