import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeStorage } from "../test-setup";
import { GENERATE_DRAFT_MESSAGE, isGenerateDraftRequest } from "../content/core/messaging";

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    workspaces: vi.fn(),
    gmailConnection: vi.fn(),
    generateDraftByProviderThread: vi.fn(),
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
import { handleGenerateDraftRequest } from "./draftHandler";
import { resetSummaryClient } from "./summaryHandler";

const REQUEST = {
  type: GENERATE_DRAFT_MESSAGE,
  accountEmail: "ada@example.com",
  providerThreadId: "18f0abc",
} as const;

const DRAFT = { id: "d1", subject: "Re: Kickoff", body: "Thursday works.", status: "PROPOSED" };

beforeEach(() => {
  vi.clearAllMocks();
  resetChromeStorage();
  resetSummaryClient();
  mockTokenStore.get.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  mockClient.workspaces.mockResolvedValue([{ id: "ws-1" }]);
  mockClient.gmailConnection.mockResolvedValue({ gmailAddress: "ada@example.com" });
  mockClient.generateDraftByProviderThread.mockResolvedValue({ draft: DRAFT, isNew: true });
});

describe("isGenerateDraftRequest", () => {
  it("accepts a well-formed request", () => {
    expect(isGenerateDraftRequest(REQUEST)).toBe(true);
  });

  it("rejects anything else on the message bus", () => {
    expect(isGenerateDraftRequest(null)).toBe(false);
    expect(isGenerateDraftRequest({ type: "amarnai:threadSummary" })).toBe(false);
    expect(isGenerateDraftRequest({ ...REQUEST, providerThreadId: 42 })).toBe(false);
    expect(isGenerateDraftRequest({ type: GENERATE_DRAFT_MESSAGE })).toBe(false);
  });
});

describe("handleGenerateDraftRequest", () => {
  it("returns the draft body and id on success", async () => {
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: true,
      result: { kind: "draft", draftId: "d1", body: "Thursday works." },
    });
  });

  it("answers signedOut without calling the API when there are no tokens", async () => {
    mockTokenStore.get.mockResolvedValue(null);
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
    expect(mockClient.generateDraftByProviderThread).not.toHaveBeenCalled();
  });

  it("answers noWorkspace when no workspace has this mailbox connected", async () => {
    mockClient.gmailConnection.mockResolvedValue({ gmailAddress: "someone-else@example.com" });
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noWorkspace",
    });
    expect(mockClient.generateDraftByProviderThread).not.toHaveBeenCalled();
  });

  it("answers error when workspace resolution itself fails", async () => {
    mockClient.workspaces.mockRejectedValue(new Error("network down"));
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });

  it("resolves an Outlook mailbox through the same connection lookup", async () => {
    // gmailConnection is provider-agnostic despite the name — it returns whatever
    // address the workspace has connected. Pinned by a test so a future reader
    // does not 'fix' the loop into a Gmail-only one.
    mockClient.gmailConnection.mockResolvedValue({
      provider: "OUTLOOK",
      gmailAddress: "ada@example.com",
    });
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toMatchObject({ ok: true });
  });

  it("maps a quota refusal to the quota payload", async () => {
    mockClient.generateDraftByProviderThread.mockResolvedValue({
      quotaExceeded: true,
      used: 3,
      limit: 3,
      resetsAt: "2026-08-01T00:00:00Z",
    });
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: true,
      result: { kind: "quota", used: 3, limit: 3, resetsAt: "2026-08-01T00:00:00Z" },
    });
  });

  it("maps an unsorted thread to notSorted, which the button offers to retry", async () => {
    mockClient.generateDraftByProviderThread.mockResolvedValue({ notClassified: true });
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: true,
      result: { kind: "notSorted" },
    });
  });

  it("maps the workspace kill-switch to injectionDisabled, not error", async () => {
    mockClient.generateDraftByProviderThread.mockRejectedValue(
      new InjectionDisabledError("Reply button injection is disabled for this workspace"),
    );
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "injectionDisabled",
    });
  });

  it("maps a not-found thread to noThread, and other failures to error", async () => {
    mockClient.generateDraftByProviderThread.mockRejectedValue(new Error("Thread not found"));
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "noThread",
    });

    mockClient.generateDraftByProviderThread.mockRejectedValue(new Error("API returned 500"));
    await expect(handleGenerateDraftRequest(REQUEST)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });
});

describe("handleGenerateDraftRequest waiting on a concurrent generation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls until the in-flight generation lands, without starting a second one", async () => {
    mockClient.generateDraftByProviderThread
      .mockResolvedValueOnce({ generating: true })
      .mockResolvedValueOnce({ generating: true })
      .mockResolvedValueOnce({ draft: DRAFT, isNew: false });

    const promise = handleGenerateDraftRequest(REQUEST);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toEqual({
      ok: true,
      result: { kind: "draft", draftId: "d1", body: "Thursday works." },
    });
    // Three polls, never a fourth: a duplicate generation would double-charge.
    expect(mockClient.generateDraftByProviderThread).toHaveBeenCalledTimes(3);
  });

  it("gives up with error when the generation never lands", async () => {
    mockClient.generateDraftByProviderThread.mockResolvedValue({ generating: true });

    const promise = handleGenerateDraftRequest(REQUEST);
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).resolves.toEqual({ ok: false, reason: "error" });
    // Bounded: ~30s of 2s polls, not an unbounded spin on the mail page.
    expect(mockClient.generateDraftByProviderThread.mock.calls.length).toBeLessThanOrEqual(16);
  });
});
