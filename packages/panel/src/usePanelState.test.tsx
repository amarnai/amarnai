import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { InjectionDisabledError, type ApiClient } from "@amarnai/api-client";
import { usePanelState } from "./usePanelState.js";
import type { PanelHost, PanelThreadContext } from "./host.js";

// The panel lives inside someone else's UI, so most of what it does is decide
// which of several perfectly ordinary "nothing to show" situations it is in.
// These tests drive that decision with a fake host and a mocked client; no
// mail client, no network.

const THREAD = {
  id: "t1",
  subject: "Kickoff",
  triageStatus: "SORTED",
  isClassifying: false,
  isImportant: false,
  messages: [],
} as never;

function makeHost(overrides: Partial<PanelHost> = {}) {
  let emitContext: (ctx: PanelThreadContext | null) => void = () => {};
  let emitVisibility: (visible: boolean) => void = () => {};
  const host: PanelHost = {
    capabilities: { insertDraft: true, signIn: true, openExternal: true },
    apiBaseUrl: "https://api.test",
    tokenStore: {
      get: vi.fn().mockResolvedValue({
        accessToken: "a",
        refreshToken: "r",
        refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
      }),
      set: vi.fn(),
      clear: vi.fn(),
    },
    onThreadContext: (listener) => {
      emitContext = listener;
      return () => {};
    },
    onVisibilityChanged: (listener) => {
      emitVisibility = listener;
      return () => {};
    },
    insertDraft: vi.fn().mockResolvedValue(true),
    requestSignIn: vi.fn(),
    openExternal: vi.fn(),
    ...overrides,
  };
  return {
    host,
    setContext: (ctx: PanelThreadContext | null) => act(() => emitContext(ctx)),
    setVisible: (v: boolean) => act(() => emitVisibility(v)),
  };
}

function makeApi(overrides: Partial<ApiClient> = {}) {
  return {
    me: vi.fn().mockResolvedValue({}),
    mailAccounts: vi.fn().mockResolvedValue({
      accounts: [
        {
          email: "ada@example.com",
          workspaceId: "ws-1",
          workspaceName: "Ada",
          provider: "GMAIL",
          status: "ACTIVE",
        },
      ],
    }),
    resolveProviderThread: vi.fn().mockResolvedValue(THREAD),
    ...overrides,
  } as unknown as ApiClient;
}

const CONTEXT: PanelThreadContext = {
  providerThreadId: "18f0abc",
  accountEmail: "ada@example.com",
};

function render(api: ApiClient, host: PanelHost) {
  return renderHook(() => usePanelState({ api, host, visible: true }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});

describe("usePanelState", () => {
  it("loads the thread once the mail client reports a conversation", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);

    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    expect(result.current.stage).toMatchObject({ workspaceId: "ws-1", accountEmail: "ada@example.com" });
    expect(api.resolveProviderThread).toHaveBeenCalledWith("ws-1", "18f0abc");
  });

  it("says signedOut without asking the API anything", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost({
      tokenStore: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), clear: vi.fn() },
    });
    const { result } = render(api, host);
    setContext(CONTEXT);

    await waitFor(() => expect(result.current.stage.kind).toBe("signedOut"));
    expect(api.mailAccounts).not.toHaveBeenCalled();
  });

  // The mail client is showing a folder list, not a conversation. Not an error.
  it("says noThread when the host reports no conversation", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext(null);
    await waitFor(() => expect(result.current.stage.kind).toBe("noThread"));
  });

  it("says notConnected when the user has no mailbox connected anywhere", async () => {
    const api = makeApi({ mailAccounts: vi.fn().mockResolvedValue({ accounts: [] }) });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);
    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("notConnected"));
  });

  // The ordinary multi-login case, which must name the address rather than look
  // like a malfunction.
  it("says mismatch, with the address, when the open mailbox is a different one", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext({ providerThreadId: "18f0abc", accountEmail: "someone@else.com" });

    await waitFor(() => expect(result.current.stage.kind).toBe("mismatch"));
    expect(result.current.stage).toMatchObject({ accountEmail: "someone@else.com" });
  });

  it("matches the mailbox case-insensitively", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext({ providerThreadId: "18f0abc", accountEmail: "Ada@Example.COM" });
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
  });

  it("says unknownThread when the conversation has never synced", async () => {
    const api = makeApi({ resolveProviderThread: vi.fn().mockResolvedValue(null) });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);
    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("unknownThread"));
  });

  // A refusal, not a failure: no retry is offered and none should happen.
  it("latches on injectionDisabled", async () => {
    const api = makeApi({
      resolveProviderThread: vi.fn().mockRejectedValue(new InjectionDisabledError("off")),
    });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);
    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("injectionDisabled"));
  });

  it("says error, retryably, when the API cannot be reached", async () => {
    const api = makeApi({
      resolveProviderThread: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);
    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("error"));

    vi.mocked(api.resolveProviderThread).mockResolvedValue(THREAD);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
  });

  // A slow resolve for the conversation the user just left must not render its
  // thread under the current one.
  it("discards a resolve that lands after the conversation changed", async () => {
    let resolveFirst!: (v: unknown) => void;
    const api = makeApi({
      // Keyed on the conversation, not on call order: which of the two resolves
      // is issued first is exactly what this test must not depend on.
      resolveProviderThread: vi.fn((_ws: string, providerThreadId: string) =>
        providerThreadId === "18f0abc"
          ? new Promise<never>((r) => { resolveFirst = r as (v: unknown) => void; })
          : Promise.resolve({ ...(THREAD as object), id: "t2" } as never),
      ),
    });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);
    await waitFor(() =>
      expect(api.resolveProviderThread).toHaveBeenCalledWith("ws-1", "18f0abc"),
    );

    setContext({ providerThreadId: "18f0def", accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage).toMatchObject({ thread: { id: "t2" } }));

    await act(async () => {
      resolveFirst({ ...(THREAD as object), id: "t1" });
    });
    expect(result.current.stage).toMatchObject({ thread: { id: "t2" } });
  });

  // The mailbox → workspace mapping only changes when someone connects or
  // disconnects a mailbox, which cannot happen while a mail page is open.
  it("resolves the mail accounts once across conversation changes", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    setContext({ providerThreadId: "other", accountEmail: "ada@example.com" });
    await waitFor(() => expect(api.resolveProviderThread).toHaveBeenCalledTimes(2));

    expect(api.mailAccounts).toHaveBeenCalledTimes(1);
  });

  // A failed accounts load is deliberately not cached, so the error state's
  // retry is a real retry.
  it("re-fetches the accounts after a failed load", async () => {
    const api = makeApi({ mailAccounts: vi.fn().mockRejectedValue(new Error("offline")) });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("error"));

    vi.mocked(api.mailAccounts).mockResolvedValue({
      accounts: [
        {
          email: "ada@example.com",
          workspaceId: "ws-1",
          workspaceName: "Ada",
          provider: "GMAIL",
          status: "ACTIVE",
        },
      ],
    });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    expect(api.mailAccounts).toHaveBeenCalledTimes(2);
  });

  it("patches the loaded thread in place", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));

    act(() => result.current.patchThread({ isImportant: true }));
    expect(result.current.stage).toMatchObject({ thread: { isImportant: true, id: "t1" } });
  });
});
