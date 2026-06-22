/**
 * Tests for FrontierAIProvider's HTTP error mapping.
 *
 * An invalid API key returns HTTP 401 from the chat completions endpoint. The
 * provider must surface that as LLMAuthenticationError so callers can fail fast
 * instead of retrying a permanent misconfiguration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import { FrontierAIProvider, LLMAuthenticationError, LLMRequestError } from "../providers/frontier.js";

const provider = new FrontierAIProvider({
  provider: "gemini",
  apiKey: "bad-key",
  model: "gemini-2.5-flash",
});

const MESSAGES = [{ role: "user" as const, content: "hi" }];

beforeEach(() => {
  createMock.mockReset();
});

describe("FrontierAIProvider", () => {
  it("maps a 401 to LLMAuthenticationError", async () => {
    createMock.mockRejectedValueOnce(
      Object.assign(new Error("Incorrect API key provided"), { status: 401 }),
    );

    await expect(provider.chat(MESSAGES)).rejects.toBeInstanceOf(LLMAuthenticationError);
  });

  it("rethrows non-auth errors unchanged", async () => {
    createMock.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { status: 429 }),
    );

    const err = await provider.chat(MESSAGES).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LLMAuthenticationError);
    expect((err as Error).message).toContain("rate limited");
  });

  it.each([400, 403, 404, 422])(
    "maps a deterministic %i to a non-retryable LLMRequestError",
    async (status) => {
      createMock.mockRejectedValueOnce(
        Object.assign(new Error("bad request"), { status }),
      );

      const err = await provider.chat(MESSAGES).catch((e) => e);
      expect(err).toBeInstanceOf(LLMRequestError);
      expect((err as LLMRequestError).status).toBe(status);
    },
  );

  it.each([408, 429])(
    "rethrows transient %i raw (retryable, not LLMRequestError)",
    async (status) => {
      createMock.mockRejectedValueOnce(
        Object.assign(new Error("transient"), { status }),
      );

      const err = await provider.chat(MESSAGES).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(LLMRequestError);
      expect((err as Error).message).toContain("transient");
    },
  );

  it("returns the message content on success", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
    });

    await expect(provider.chat(MESSAGES)).resolves.toBe('{"ok":true}');
  });

  it("throws when the LLM returns no content", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: {} }] });

    await expect(provider.chat(MESSAGES)).rejects.toThrow("no content");
  });
});

describe("FrontierAIProvider reasoning_effort by provider", () => {
  const okResponse = { choices: [{ message: { content: "{}" } }] };

  it("sends reasoning_effort:'none' for Gemini", async () => {
    const gemini = new FrontierAIProvider({
      provider: "gemini",
      apiKey: "k",
      model: "gemini-2.5-flash",
      reasoningEffort: "none",
    });
    createMock.mockResolvedValueOnce(okResponse);

    await gemini.chat(MESSAGES);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_effort: "none" }),
    );
  });

  it("omits reasoning_effort for OpenAI when it is 'none'", async () => {
    const openai = new FrontierAIProvider({
      provider: "openai",
      apiKey: "k",
      model: "gpt-4o-mini",
      reasoningEffort: "none",
    });
    createMock.mockResolvedValueOnce(okResponse);

    await openai.chat(MESSAGES);

    const arg = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("reasoning_effort");
  });

  it("passes a non-'none' reasoning_effort through for OpenAI", async () => {
    const openai = new FrontierAIProvider({
      provider: "openai",
      apiKey: "k",
      model: "gpt-4o-mini",
      reasoningEffort: "low",
    });
    createMock.mockResolvedValueOnce(okResponse);

    await openai.chat(MESSAGES);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_effort: "low" }),
    );
  });
});
