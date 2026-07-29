import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { InjectionDisabledError, type ApiClient } from "@amarnai/api-client";
import { QueuePanel } from "./QueuePanel.js";
import { clearQueueCache, invalidateQueue } from "./useQueueState.js";
import type { PanelHost } from "../host.js";
import type { PanelQueueResult, PanelQueueThread } from "../types.js";

// The screen the panel shows when the user is looking at their thread list.
// These tests pin the two things it must get right — that it lists only what is
// waiting on the user, and that acting on a row acts on the real thread — plus
// the collapse state, which survives a remount because the panel is remounted
// constantly in a real mail client.

i18n.load("en", {});
i18n.activate("en");

afterEach(cleanup);
beforeEach(() => {
  clearQueueCache();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});

function thread(overrides: Partial<PanelQueueThread> = {}): PanelQueueThread {
  return {
    id: "t1",
    subject: "Kickoff",
    provider: "GMAIL",
    providerThreadId: "18f0abc",
    webLink: null,
    latestMessageAt: "2026-07-29T10:00:00.000Z",
    senderName: "Ada Lovelace",
    senderEmail: "ada@example.com",
    doneMark: null,
    ...overrides,
  };
}

function queue(overrides: Partial<PanelQueueResult> = {}): PanelQueueResult {
  return {
    assignedToMe: { threads: [thread()], count: 1 },
    needsReview: { threads: [], count: 0 },
    proposedDrafts: { threads: [], count: 0 },
    pendingCount: 0,
    pendingWaitingCount: 0,
    ...overrides,
  };
}

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    me: vi.fn().mockResolvedValue({}),
    panelQueue: vi.fn().mockResolvedValue(queue()),
    syncStatus: vi.fn().mockResolvedValue(null),
    markThreadDone: vi.fn().mockResolvedValue({
      ok: true,
      doneMark: {
        userId: "u1",
        userEmail: "ada@example.com",
        userName: "Ada",
        resolvedAt: "2026-07-29T11:00:00.000Z",
      },
    }),
    unmarkThreadDone: vi.fn().mockResolvedValue({ ok: true, doneMark: null }),
    ...overrides,
  } as unknown as ApiClient;
}

function makeHost(overrides: Partial<PanelHost> = {}): PanelHost {
  return {
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
    onThreadContext: () => () => {},
    onVisibilityChanged: () => () => {},
    insertDraft: vi.fn().mockResolvedValue(true),
    openThread: vi.fn(),
    requestSignIn: vi.fn(),
    openExternal: vi.fn(),
    ...overrides,
  };
}

function renderPanel(opts: { api?: ApiClient; host?: PanelHost; onInjectionDisabled?: () => void } = {}) {
  const host = opts.host ?? makeHost();
  const onInjectionDisabled = opts.onInjectionDisabled ?? vi.fn();
  const view = render(
    <I18nProvider i18n={i18n}>
      <QueuePanel
        api={opts.api ?? makeApi()}
        host={host}
        workspaceId="ws-1"
        accountEmail="ada@example.com"
        visible
        onInjectionDisabled={onInjectionDisabled}
      />
    </I18nProvider>,
  );
  return { host, onInjectionDisabled, view };
}

describe("QueuePanel", () => {
  it("lists the sections that have something in them", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({
          needsReview: { threads: [thread({ id: "t2", subject: "Invoice" })], count: 4 },
        }),
      ),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    expect(await screen.findByRole("button", { name: /Assigned to you/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Needs review/ })).toBeTruthy();
    // Nothing waiting for approval: no header promising an empty list.
    expect(screen.queryByRole("button", { name: /Drafts awaiting approval/ })).toBeNull();
  });

  // Only the section the user filled themselves is open on arrival. The other
  // two are as long as the inbox makes them.
  it("opens only the assigned section by default", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({
          needsReview: { threads: [thread({ id: "t2", subject: "Invoice" })], count: 12 },
          proposedDrafts: { threads: [thread({ id: "t3", subject: "Renewal" })], count: 2 },
        }),
      ),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    expect((await screen.findByRole("button", { name: /Assigned to you/ })).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Needs review/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Drafts awaiting approval/ }).getAttribute("aria-expanded")).toBe("false");

    expect(screen.getByText("Kickoff")).toBeTruthy();
    expect(screen.queryByText("Invoice")).toBeNull();
    expect(screen.queryByText("Renewal")).toBeNull();
  });

  // A collapsed section that did not say how much was behind it would be
  // indistinguishable from an absent one.
  it("starts needs review collapsed, with its count still visible", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({
          needsReview: { threads: [thread({ id: "t2", subject: "Invoice" })], count: 12 },
        }),
      ),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    const header = await screen.findByRole("button", { name: /Needs review/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.textContent).toContain("12");
    expect(screen.queryByText("Invoice")).toBeNull();

    fireEvent.click(header);
    expect(await screen.findByText("Invoice")).toBeTruthy();
  });

  it("remembers an expanded section across a remount", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({
          needsReview: { threads: [thread({ id: "t2", subject: "Invoice" })], count: 12 },
        }),
      ),
    } as unknown as Partial<ApiClient>);
    const { view } = renderPanel({ api });

    fireEvent.click(await screen.findByRole("button", { name: /Needs review/ }));
    await screen.findByText("Invoice");

    view.unmount();
    renderPanel({ api });

    // The panel is remounted on every navigation between the list and a
    // conversation; re-collapsing each time would make the section unusable.
    expect(await screen.findByText("Invoice")).toBeTruthy();
  });

  it("asks the host to open the conversation where it can", async () => {
    const host = makeHost();
    renderPanel({ host });

    fireEvent.click(await screen.findByRole("button", { name: /Open conversation/ }));

    expect(host.openThread).toHaveBeenCalledWith("18f0abc");
  });

  // Outlook's task pane cannot navigate itself, so the row becomes a link out.
  it("falls back to an account-routed link when the host cannot navigate", async () => {
    const host = makeHost({
      capabilities: { insertDraft: true, signIn: true, openExternal: false, openThread: false },
    });
    renderPanel({ host });

    const link = await screen.findByRole("link", { name: /Open conversation/ });
    expect(link.getAttribute("href")).toBe(
      "https://mail.google.com/mail/?authuser=ada%40example.com#all/18f0abc",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("uses the Outlook deep link for an Outlook thread", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({
          assignedToMe: {
            threads: [
              thread({ provider: "OUTLOOK", webLink: "https://outlook.office.com/mail/id/AAA" }),
            ],
            count: 1,
          },
        }),
      ),
    } as unknown as Partial<ApiClient>);
    const host = makeHost({
      capabilities: { insertDraft: true, signIn: true, openExternal: false, openThread: false },
    });
    renderPanel({ api, host });

    const link = await screen.findByRole("link", { name: /Open conversation/ });
    expect(link.getAttribute("href")).toContain("https://outlook.office.com/mail/id/AAA");
    expect(link.getAttribute("href")).toContain("ispopout=0");
  });

  it("marks a thread done from the row and drops it from the assigned list", async () => {
    const api = makeApi();
    renderPanel({ api });

    fireEvent.click(await screen.findByRole("button", { name: "Mark as done" }));

    await waitFor(() => expect(api.markThreadDone).toHaveBeenCalledWith("ws-1", "t1", ""));
    // Done means off this user's plate, so the assigned section stops showing it.
    await waitFor(() => expect(screen.queryByText("Kickoff")).toBeNull());
  });

  it("clears a done mark without waiting for the server", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({
          assignedToMe: { threads: [], count: 0 },
          needsReview: {
            threads: [
              thread({
                id: "t2",
                subject: "Invoice",
                doneMark: {
                  userId: "u1",
                  userEmail: "ada@example.com",
                  userName: "Ada",
                  resolvedAt: "2026-07-29T09:00:00.000Z",
                },
              }),
            ],
            count: 1,
          },
        }),
      ),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    fireEvent.click(await screen.findByRole("button", { name: /Needs review/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark as not done" }));

    expect(await screen.findByRole("button", { name: "Mark as done" })).toBeTruthy();
    await waitFor(() => expect(api.unmarkThreadDone).toHaveBeenCalledWith("ws-1", "t2", ""));
  });

  it("says so when nothing is waiting, and how to put something there", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(
        queue({ assignedToMe: { threads: [], count: 0 } }),
      ),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    expect(await screen.findByText(/Nothing is waiting on you/)).toBeTruthy();
    expect(screen.getByText(/Assign a thread to yourself/)).toBeTruthy();
  });

  it("shows the sorting strip only while threads are in flight", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockResolvedValue(queue({ pendingCount: 5, pendingWaitingCount: 2 })),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    // Pending minus waiting: two of the five have no classify job yet.
    expect(await screen.findByText("Sorting 3 threads…")).toBeTruthy();
  });

  it("shows the backfill strip while past threads are still loading", async () => {
    const api = makeApi({
      syncStatus: vi.fn().mockResolvedValue({
        backfillStatus: "RUNNING",
        backfillAwaitingTaxonomy: false,
      }),
    } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    expect(await screen.findByText("Loading past threads…")).toBeTruthy();
  });

  it("hides the strip when nothing is happening", async () => {
    renderPanel();

    await screen.findByText("Kickoff");
    expect(screen.queryByText(/Sorting/)).toBeNull();
    expect(screen.queryByText("Loading past threads…")).toBeNull();
  });

  // The queue is the only request the no-conversation view makes, so it is the
  // only place it can learn the workspace switched the panel off.
  it("reports an injection-disabled workspace to the panel", async () => {
    const api = makeApi({
      panelQueue: vi.fn().mockRejectedValue(new InjectionDisabledError("off")),
    } as unknown as Partial<ApiClient>);
    const { onInjectionDisabled } = renderPanel({ api });

    await waitFor(() => expect(onInjectionDisabled).toHaveBeenCalled());
  });

  // The thread view mutates the same threads this queue lists, and the two never
  // render together. Without the invalidation, unmarking a thread done on the
  // conversation screen would leave it sitting here still done, which reads as
  // the change not having happened.
  it("refetches after the other screen changed a thread", async () => {
    const done = {
      userId: "u1",
      userEmail: "ada@example.com",
      userName: "Ada",
      resolvedAt: "2026-07-29T09:00:00.000Z",
    };
    const panelQueue = vi
      .fn()
      // As the queue last saw it: done, so still listed under needs review and
      // already gone from the assigned section.
      .mockResolvedValueOnce(
        queue({
          assignedToMe: { threads: [], count: 0 },
          needsReview: {
            threads: [thread({ id: "t2", subject: "Invoice", doneMark: done })],
            count: 1,
          },
        }),
      )
      // As the server has it after the thread view unmarked it.
      .mockResolvedValue(
        queue({
          assignedToMe: { threads: [thread({ id: "t2", subject: "Invoice" })], count: 1 },
          needsReview: { threads: [thread({ id: "t2", subject: "Invoice" })], count: 1 },
        }),
      );
    const api = makeApi({ panelQueue } as unknown as Partial<ApiClient>);

    const first = renderPanel({ api });
    fireEvent.click(await screen.findByRole("button", { name: /Needs review/ }));
    expect(await screen.findByRole("button", { name: "Mark as not done" })).toBeTruthy();
    first.view.unmount();

    // What the thread view's mutations do.
    invalidateQueue("ws-1");
    renderPanel({ api });

    await waitFor(() => expect(panelQueue).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /Assigned to you/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark as not done" })).toBeNull());
  });

  // Expired, not dropped: a revalidation must not blank the queue to a spinner.
  it("keeps the stale rows on screen while it revalidates", async () => {
    const api = makeApi();
    const { view } = renderPanel({ api });
    await screen.findByText("Kickoff");
    view.unmount();

    invalidateQueue("ws-1");
    renderPanel({ api });

    // Present on the very first frame, before the refetch resolves.
    expect(screen.getByText("Kickoff")).toBeTruthy();
    await waitFor(() => expect(api.panelQueue).toHaveBeenCalledTimes(2));
  });

  it("offers a retry when the queue cannot be loaded", async () => {
    const panelQueue = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(queue());
    const api = makeApi({ panelQueue } as unknown as Partial<ApiClient>);
    renderPanel({ api });

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Kickoff")).toBeTruthy();
  });
});
