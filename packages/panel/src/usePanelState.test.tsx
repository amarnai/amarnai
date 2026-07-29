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
    capabilities: { insertDraft: true, signIn: true, openExternal: true, openThread: true },
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
    openThread: vi.fn(),
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

  // The host could not read the mailbox at all. Without an address there is no
  // workspace, so there is nothing to show — not even the queue.
  it("says noThread when the host reports no mailbox", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext(null);
    await waitFor(() => expect(result.current.stage.kind).toBe("noThread"));
  });

  // The thread list: no conversation, but a mailbox we can map to a workspace.
  it("says queue when the mailbox is known and no conversation is open", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });

    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));
    expect(result.current.stage).toMatchObject({
      workspaceId: "ws-1",
      accountEmail: "ada@example.com",
    });
    // Nothing to resolve: there is no conversation.
    expect(api.resolveProviderThread).not.toHaveBeenCalled();
  });

  // An unconnected mailbox is unconnected whether or not a conversation is open,
  // so these checks must still win over the queue.
  it("prefers mismatch over the queue for an unknown mailbox", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext({ providerThreadId: null, accountEmail: "someone@else.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("mismatch"));
  });

  it("prefers notConnected over the queue when no mailbox is connected", async () => {
    const api = makeApi({ mailAccounts: vi.fn().mockResolvedValue({ accounts: [] }) });
    const { host, setContext } = makeHost();
    const { result } = render(api, host);
    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("notConnected"));
  });

  it("moves between the queue and a thread as the user navigates", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));
  });

  // The queue's own fetch is the only place the no-conversation view can learn
  // the workspace switched the panel off, so it has to be able to say so.
  it("latches injectionDisabled when the queue reports it", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);
    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));

    act(() => result.current.reportInjectionDisabled());
    expect(result.current.stage.kind).toBe("injectionDisabled");
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

  // The back control on the thread screen. The mail client keeps the
  // conversation open throughout, so this is a panel-side screen change and
  // nothing else.
  it("shows the queue over an open conversation, and goes back to it", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));

    act(() => result.current.showQueue());
    expect(result.current.stage).toMatchObject({
      kind: "queue",
      workspaceId: "ws-1",
      accountEmail: "ada@example.com",
      overConversation: true,
    });

    act(() => result.current.showConversation());
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
  });

  // The queue's rows can change the very thread being returned to, and while it
  // was on screen the thread held no stream of its own.
  it("re-resolves the conversation on the way back from the queue", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    expect(api.resolveProviderThread).toHaveBeenCalledTimes(1);

    act(() => result.current.showQueue());
    act(() => result.current.showConversation());

    await waitFor(() => expect(api.resolveProviderThread).toHaveBeenCalledTimes(2));
  });

  // Opening a different conversation is a fresh screen: carrying the override
  // across would show the queue over the thread the user just chose to open.
  it("drops the queue override when the conversation changes", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    act(() => result.current.showQueue());
    expect(result.current.stage.kind).toBe("queue");

    setContext({ providerThreadId: "18f0def", accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
  });

  // The thread list's own queue has no conversation behind it, so it must not
  // offer a way back to one.
  it("marks the thread list's queue as not being over a conversation", async () => {
    const { host, setContext } = makeHost();
    const { result } = render(makeApi(), host);

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));
    expect(result.current.stage).toMatchObject({ overConversation: false });
  });

  // The click this whole path exists for: the queue is open over the very
  // conversation the user picks. Gmail is asked to open it and reports nothing
  // back, because its hash already says so — and the panel must still switch.
  it("shows a picked thread the mail client is already showing", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext(CONTEXT);
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    act(() => result.current.showQueue());
    expect(result.current.stage.kind).toBe("queue");

    act(() => result.current.openThread("18f0abc"));

    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    expect(host.openThread).toHaveBeenCalledWith("18f0abc");
    // Still the client's own conversation, so a draft may be inserted into it.
    expect(result.current.threadIsOpenInClient).toBe(true);
  });

  // A host that cannot navigate at all (Outlook's task pane). The panel is the
  // only thing that moves, and it moves anyway.
  it("shows a picked thread a host cannot navigate to", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost({
      capabilities: { insertDraft: true, signIn: true, openExternal: false, openThread: false },
    });
    const { result } = render(api, host);

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));

    act(() => result.current.openThread("18f0def"));

    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    expect(api.resolveProviderThread).toHaveBeenCalledWith("ws-1", "18f0def");
    expect(host.openThread).not.toHaveBeenCalled();
    // The pane is still on whatever it was: inserting here would reply to the
    // wrong conversation, so the panel says the two do not match.
    expect(result.current.threadIsOpenInClient).toBe(false);
  });

  // The client catching up with the pick is not a second conversation change.
  it("does not re-resolve when the client catches up with the pick", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));

    act(() => result.current.openThread("18f0def"));
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));
    expect(api.resolveProviderThread).toHaveBeenCalledTimes(1);

    setContext({ providerThreadId: "18f0def", accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.threadIsOpenInClient).toBe(true));
    expect(result.current.stage.kind).toBe("thread");
    expect(api.resolveProviderThread).toHaveBeenCalledTimes(1);
  });

  // A pick is not a pin: the page moving anywhere else takes the screen back.
  it("follows the mail client again once it navigates elsewhere", async () => {
    const api = makeApi();
    const { host, setContext } = makeHost();
    const { result } = render(api, host);

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));
    act(() => result.current.openThread("18f0def"));
    await waitFor(() => expect(result.current.stage.kind).toBe("thread"));

    setContext({ providerThreadId: null, accountEmail: "ada@example.com" });
    await waitFor(() => expect(result.current.stage.kind).toBe("queue"));
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
