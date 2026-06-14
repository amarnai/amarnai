/**
 * Tests for OpenAIEmbeddingProvider's request shaping.
 *
 * Verifies that the optional `dimensions` knob is forwarded to the embeddings
 * API and folded into the model identity (so a dimension change invalidates
 * stored vectors via the staleness path), while the bare model name is sent to
 * the API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn(async (params: { model: string; input: string[]; dimensions?: number }) => ({
  data: params.input.map((_, index) => ({ index, embedding: [0.1, 0.2] })),
}));

vi.mock("openai", () => ({
  default: class {
    embeddings = { create: createMock };
  },
}));

import { OpenAIEmbeddingProvider } from "../providers/embedding-openai.js";

beforeEach(() => {
  createMock.mockClear();
});

describe("OpenAIEmbeddingProvider", () => {
  it("omits dimensions and keeps a bare modelName when none is configured", async () => {
    const provider = new OpenAIEmbeddingProvider({
      provider: "openai",
      apiKey: "test-key",
      model: "text-embedding-3-small",
    });

    await provider.embed(["hello"]);

    const params = createMock.mock.calls[0]![0];
    expect(params.model).toBe("text-embedding-3-small");
    expect(params).not.toHaveProperty("dimensions");
    expect(provider.modelName).toBe("text-embedding-3-small");
  });

  it("forwards dimensions and folds it into modelName when configured", async () => {
    const provider = new OpenAIEmbeddingProvider({
      provider: "openai",
      apiKey: "test-key",
      model: "text-embedding-3-small",
      dimensions: 768,
    });

    await provider.embed(["hello"]);

    const params = createMock.mock.calls[0]![0];
    expect(params.model).toBe("text-embedding-3-small");
    expect(params.dimensions).toBe(768);
    expect(provider.modelName).toBe("text-embedding-3-small@768");
  });
});
