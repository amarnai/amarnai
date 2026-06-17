import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockGet, mockSet, mockQuit } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockQuit: vi.fn(),
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    quit: mockQuit,
    on: vi.fn(),
  })),
}));

vi.mock("@amarnai/config", () => ({
  config: { redis: { url: "redis://localhost:6379" } },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────────

import {
  buildDedupKey,
  buildEmbeddingCacheKey,
  memoizeAcrossRetries,
  parseVector,
  type MemoCodec,
} from "../ai-dedup.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

const VECTOR = [0.1, 0.2, 0.3];

function vectorCodec(compute: () => Promise<number[]>): MemoCodec<number[]> {
  return {
    compute,
    serialize: (v) => JSON.stringify(v),
    deserialize: parseVector,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue("OK");
});

// ─── buildDedupKey ───────────────────────────────────────────────────────────────

describe("buildDedupKey", () => {
  it("builds a workspace-scoped key tied to jobId, step, and model", () => {
    expect(buildDedupKey("ws-1", "job-1", "thread-embedding", "model-x")).toBe(
      "aidedup:ws-1:job-1:thread-embedding:model-x",
    );
  });

  it("returns null when jobId is undefined", () => {
    expect(buildDedupKey("ws-1", undefined, "thread-embedding", "model-x")).toBeNull();
  });
});

// ─── buildEmbeddingCacheKey ──────────────────────────────────────────────────────

describe("buildEmbeddingCacheKey", () => {
  it("builds a content-addressed key scoped by workspace, model, and hash", () => {
    expect(buildEmbeddingCacheKey("ws-1", "abc123", "model-x")).toBe(
      "aiembed:ws-1:model-x:abc123",
    );
  });

  it("is independent of any jobId: same content yields the same key", () => {
    const a = buildEmbeddingCacheKey("ws-1", "abc123", "model-x");
    const b = buildEmbeddingCacheKey("ws-1", "abc123", "model-x");
    expect(a).toBe(b);
  });
});

// ─── memoizeAcrossRetries ────────────────────────────────────────────────────────

describe("memoizeAcrossRetries", () => {
  it("miss: calls compute once and stores the serialized value with a TTL", async () => {
    mockGet.mockResolvedValue(null);
    const compute = vi.fn().mockResolvedValue(VECTOR);

    const result = await memoizeAcrossRetries("k", vectorCodec(compute));

    expect(result).toEqual(VECTOR);
    expect(compute).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith("k", JSON.stringify(VECTOR), "EX", 900);
  });

  it("uses a caller-supplied TTL when provided (overrides the default)", async () => {
    mockGet.mockResolvedValue(null);
    const compute = vi.fn().mockResolvedValue(VECTOR);

    await memoizeAcrossRetries("k", vectorCodec(compute), 21600);

    expect(mockSet).toHaveBeenCalledWith("k", JSON.stringify(VECTOR), "EX", 21600);
  });

  it("hit: returns the cached value without calling compute", async () => {
    mockGet.mockResolvedValue(JSON.stringify(VECTOR));
    const compute = vi.fn().mockResolvedValue([9, 9, 9]);

    const result = await memoizeAcrossRetries("k", vectorCodec(compute));

    expect(result).toEqual(VECTOR);
    expect(compute).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("read error: falls back to compute and still returns the result", async () => {
    mockGet.mockRejectedValue(new Error("redis down"));
    const compute = vi.fn().mockResolvedValue(VECTOR);

    const result = await memoizeAcrossRetries("k", vectorCodec(compute));

    expect(result).toEqual(VECTOR);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("write error: still returns the computed result without throwing", async () => {
    mockGet.mockResolvedValue(null);
    mockSet.mockRejectedValue(new Error("redis down"));
    const compute = vi.fn().mockResolvedValue(VECTOR);

    const result = await memoizeAcrossRetries("k", vectorCodec(compute));

    expect(result).toEqual(VECTOR);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("null key: computes without touching Redis", async () => {
    const compute = vi.fn().mockResolvedValue(VECTOR);

    const result = await memoizeAcrossRetries(null, vectorCodec(compute));

    expect(result).toEqual(VECTOR);
    expect(compute).toHaveBeenCalledOnce();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("shouldCache=false: returns the computed value but does not store it", async () => {
    mockGet.mockResolvedValue(null);
    const compute = vi.fn().mockResolvedValue([]);

    const result = await memoizeAcrossRetries("k", {
      ...vectorCodec(compute),
      shouldCache: (v) => v.length > 0,
    });

    expect(result).toEqual([]);
    expect(compute).toHaveBeenCalledOnce();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("shouldCache=true: stores the computed value", async () => {
    mockGet.mockResolvedValue(null);
    const compute = vi.fn().mockResolvedValue(VECTOR);

    await memoizeAcrossRetries("k", {
      ...vectorCodec(compute),
      shouldCache: (v) => v.length > 0,
    });

    expect(mockSet).toHaveBeenCalledOnce();
  });

  it("invalid cached data: treats it as a miss and recomputes", async () => {
    mockGet.mockResolvedValue("not json");
    const compute = vi.fn().mockResolvedValue(VECTOR);

    const result = await memoizeAcrossRetries("k", vectorCodec(compute));

    expect(result).toEqual(VECTOR);
    expect(compute).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
  });
});

// ─── parseVector ─────────────────────────────────────────────────────────────────

describe("parseVector", () => {
  it("parses a finite-number array", () => {
    expect(parseVector("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns null on malformed JSON", () => {
    expect(parseVector("not json")).toBeNull();
  });

  it("returns null when the value is not an array", () => {
    expect(parseVector('{"a":1}')).toBeNull();
  });

  it("returns null for an empty array (failed-embed sentinel)", () => {
    expect(parseVector("[]")).toBeNull();
  });

  it("returns null when an element is not a finite number", () => {
    expect(parseVector('[1,"x",3]')).toBeNull();
    expect(parseVector("[1,null,3]")).toBeNull();
  });
});
