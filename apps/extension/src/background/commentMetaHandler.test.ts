import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeStorage } from "../test-setup";
import { COMMENT_META_MESSAGE, isCommentMetaRequest } from "../content/core/messaging";

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    mailAccounts: vi.fn(),
    providerThreadCommentsMeta: vi.fn(),
  },
}));

// InjectionDisabledError must be the REAL class, not a stub: the handler tells
// the workspace kill-switch apart from a generic failure with `instanceof`.
vi.mock("@aziru/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aziru/api-client")>();
  return {
    InjectionDisabledError: actual.InjectionDisabledError,
    resolveWorkspaceIdForMailbox: actual.resolveWorkspaceIdForMailbox,
    makeApiClient: () => mockClient,
    makeBearerTransport: () => ({ baseUrl: "https://api.test", fetch: vi.fn() }),
  };
});

const { mockTokenStore } = vi.hoisted(() => ({
  mockTokenStore: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

vi.mock("../auth/tokenStore", () => ({ extensionTokenStore: mockTokenStore }));

import { InjectionDisabledError } from "@aziru/api-client";
import { resetSummaryClient } from "./summaryHandler";
import { handleCommentMetaRequest } from "./commentMetaHandler";

const REQUEST = {
  type: COMMENT_META_MESSAGE,
  accountEmail: "ada@example.com",
  providerThreadId: "18f0abc",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  resetChromeStorage();
  resetSummaryClient();
  mockTokenStore.get.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  mockClient.mailAccounts.mockResolvedValue({
    accounts: [{ email: "ada@example.com", workspaceId: "ws-1" }],
  });
  mockClient.providerThreadCommentsMeta.mockResolvedValue({ total: 3, unread: 1 });
});

describe("isCommentMetaRequest", () => {
  it("accepts a well-formed request", () => {
    expect(isCommentMetaRequest(REQUEST)).toBe(true);
  });

  it("rejects anything else on the message bus", () => {
    expect(isCommentMetaRequest(null)).toBe(false);
    expect(isCommentMetaRequest({ type: "other" })).toBe(false);
    expect(isCommentMetaRequest({ type: COMMENT_META_MESSAGE })).toBe(false);
    expect(
      isCommentMetaRequest({ type: COMMENT_META_MESSAGE, accountEmail: 1, providerThreadId: "x" }),
    ).toBe(false);
  });
});

describe("handleCommentMetaRequest", () => {
  it("returns the counts for a synced thread", async () => {
    await expect(handleCommentMetaRequest(REQUEST)).resolves.toEqual({
      ok: true,
      meta: { total: 3, unread: 1 },
    });
    expect(mockClient.providerThreadCommentsMeta).toHaveBeenCalledWith("ws-1", "18f0abc");
  });

  it("answers signedOut without touching the API when there are no tokens", async () => {
    mockTokenStore.get.mockResolvedValue(null);
    await expect(handleCommentMetaRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
    expect(mockClient.mailAccounts).not.toHaveBeenCalled();
  });

  it("answers noWorkspace when the visible mailbox is not connected anywhere", async () => {
    mockClient.mailAccounts.mockResolvedValue({
      accounts: [{ email: "someone.else@example.com", workspaceId: "ws-1" }],
    });
    await expect(handleCommentMetaRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noWorkspace",
    });
    expect(mockClient.providerThreadCommentsMeta).not.toHaveBeenCalled();
  });

  it("answers noThread for a thread that was never synced (null)", async () => {
    mockClient.providerThreadCommentsMeta.mockResolvedValue(null);
    await expect(handleCommentMetaRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noThread",
    });
  });

  it("answers injectionDisabled when the workspace turned the panel off", async () => {
    mockClient.providerThreadCommentsMeta.mockRejectedValue(
      new InjectionDisabledError("panel off"),
    );
    await expect(handleCommentMetaRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "injectionDisabled",
    });
  });

  it("maps any other failure to noThread (renders nothing, never an error)", async () => {
    mockClient.providerThreadCommentsMeta.mockRejectedValue(new Error("API down"));
    await expect(handleCommentMetaRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noThread",
    });
  });
});
