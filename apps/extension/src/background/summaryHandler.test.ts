import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeStorage } from "../test-setup";
import { THREAD_SUMMARY_MESSAGE, isThreadSummaryRequest } from "../content/core/messaging";

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    workspaces: vi.fn(),
    gmailConnection: vi.fn(),
    providerThreadSummary: vi.fn(),
  },
}));

// InjectionDisabledError must be the REAL class, not a stub: the handler tells
// the workspace kill-switch apart from a generic failure with `instanceof`.
vi.mock("@amarnai/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@amarnai/api-client")>();
  return {
    InjectionDisabledError: actual.InjectionDisabledError,
    // The real resolution loop, driven by the mocked client below: this is
    // the behaviour under test, not something to stub out.
    resolveWorkspaceIdForMailbox: actual.resolveWorkspaceIdForMailbox,
    makeApiClient: () => mockClient,
    makeBearerTransport: () => ({ baseUrl: "https://api.test", fetch: vi.fn() }),
  };
});

const { mockTokenStore } = vi.hoisted(() => ({
  mockTokenStore: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

vi.mock("../auth/tokenStore", () => ({ extensionTokenStore: mockTokenStore }));

import { InjectionDisabledError } from "@amarnai/api-client";
import {
  handleThreadSummaryRequest,
  resolveWorkspaceForAccount,
  resetSummaryClient,
} from "./summaryHandler";

const REQUEST = {
  type: THREAD_SUMMARY_MESSAGE,
  accountEmail: "ada@example.com",
  providerThreadId: "18f0abc",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  resetChromeStorage();
  resetSummaryClient();
  mockTokenStore.get.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  mockClient.workspaces.mockResolvedValue([{ id: "ws-1" }]);
  mockClient.gmailConnection.mockResolvedValue({ gmailAddress: "ada@example.com" });
  mockClient.providerThreadSummary.mockResolvedValue({
    kind: "summary",
    summary: { text: "Ana needs the kickoff date.", locale: "en", generatedAt: null },
    isNew: true,
  });
});

describe("isThreadSummaryRequest", () => {
  it("accepts a well-formed request", () => {
    expect(isThreadSummaryRequest(REQUEST)).toBe(true);
  });

  it("rejects anything else on the message bus", () => {
    expect(isThreadSummaryRequest(null)).toBe(false);
    expect(isThreadSummaryRequest({ type: "other" })).toBe(false);
    expect(isThreadSummaryRequest({ type: THREAD_SUMMARY_MESSAGE })).toBe(false);
    expect(
      isThreadSummaryRequest({ type: THREAD_SUMMARY_MESSAGE, accountEmail: 1, providerThreadId: "x" }),
    ).toBe(false);
  });
});

describe("handleThreadSummaryRequest", () => {
  it("returns the summary text for a synced thread", async () => {
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: true,
      result: { kind: "summary", text: "Ana needs the kickoff date." },
    });
  });

  it("answers signedOut without touching the API when there are no tokens", async () => {
    mockTokenStore.get.mockResolvedValue(null);
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
    expect(mockClient.workspaces).not.toHaveBeenCalled();
  });

  it("answers noWorkspace when the visible mailbox is not connected anywhere", async () => {
    mockClient.gmailConnection.mockResolvedValue({ gmailAddress: "someone.else@example.com" });
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noWorkspace",
    });
    expect(mockClient.providerThreadSummary).not.toHaveBeenCalled();
  });

  it("answers noThread when the thread has never been synced (404)", async () => {
    mockClient.providerThreadSummary.mockRejectedValue(new Error("API returned 404"));
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noThread",
    });
  });

  // Told apart from noThread because the content script latches on it and stops
  // watching the page, rather than retrying a refusal on every thread open.
  it("answers injectionDisabled when the workspace has the card switched off", async () => {
    mockClient.providerThreadSummary.mockRejectedValue(
      new InjectionDisabledError("Thread summary injection is disabled for this workspace"),
    );
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "injectionDisabled",
    });
  });

  it("passes the snippet kind through so the widget can stay hidden", async () => {
    mockClient.providerThreadSummary.mockResolvedValue({ kind: "snippet", snippet: "hi" });
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: true,
      result: { kind: "snippet" },
    });
  });

  it("passes quota details through", async () => {
    mockClient.providerThreadSummary.mockResolvedValue({
      quotaExceeded: true,
      used: 50,
      limit: 50,
      resetsAt: "2026-08-01T00:00:00.000Z",
    });
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: true,
      result: { kind: "quota", used: 50, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z" },
    });
  });

  it("forwards the force flag", async () => {
    await handleThreadSummaryRequest({ ...REQUEST, force: true });
    expect(mockClient.providerThreadSummary).toHaveBeenCalledWith("ws-1", "18f0abc", { force: true });
  });

  it("answers error when the workspace lookup fails", async () => {
    mockClient.workspaces.mockRejectedValue(new Error("offline"));
    await expect(handleThreadSummaryRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });
});

describe("resolveWorkspaceForAccount", () => {
  it("matches the mailbox case-insensitively", async () => {
    mockClient.gmailConnection.mockResolvedValue({ gmailAddress: "Ada@Example.com" });
    await expect(resolveWorkspaceForAccount(mockClient as never, "ada@example.com")).resolves.toBe(
      "ws-1",
    );
  });

  it("caches the mapping so a second lookup does no API calls", async () => {
    await resolveWorkspaceForAccount(mockClient as never, "ada@example.com");
    expect(mockClient.workspaces).toHaveBeenCalledOnce();
    await resolveWorkspaceForAccount(mockClient as never, "ada@example.com");
    expect(mockClient.workspaces).toHaveBeenCalledOnce();
  });

  it("returns null when no workspace has that mailbox connected", async () => {
    mockClient.gmailConnection.mockResolvedValue(null);
    await expect(
      resolveWorkspaceForAccount(mockClient as never, "ada@example.com"),
    ).resolves.toBeNull();
  });
});
