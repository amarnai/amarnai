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

import { FrontierAIProvider, LLMAuthenticationError } from "../providers/frontier.js";

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
