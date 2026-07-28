import { describe, it, expect, beforeEach, vi } from "vitest";
import { InjectionDisabledError, type ApiClient } from "@amarnai/api-client";
import { generateAndInsertReply } from "./paneFlow";
import type { OfficeLike, OutlookContext } from "./officeHost";

const CONTEXT: OutlookContext = {
  conversationId: "AAQkAD+bc/de",
  accountEmail: "ada@example.com",
};

const DRAFT = { id: "d1", subject: "Re: Kickoff", body: "Thursday works.", status: "PROPOSED" };

function makeApi(overrides: Partial<ApiClient> = {}) {
  return {
    workspaces: vi.fn().mockResolvedValue([{ id: "ws-1" }]),
    gmailConnection: vi.fn().mockResolvedValue({ gmailAddress: "ada@example.com" }),
    generateDraftByProviderThread: vi.fn().mockResolvedValue({ draft: DRAFT, isNew: true }),
    ...overrides,
  } as unknown as ApiClient;
}

/**
 * A clock whose sleeps are instant and whose time advances by exactly what was
 * slept, so the polling loop's real 30s budget costs the test nothing while
 * still terminating on the same number of attempts it would in production.
 */
function testClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function makeOffice() {
  const replies: { htmlBody: string }[] = [];
  const office = {
    onReady: vi.fn(),
    context: {
      mailbox: {
        item: {
          conversationId: CONTEXT.conversationId,
          displayReplyForm: (reply: string | { htmlBody: string }) => {
            replies.push(reply as { htmlBody: string });
          },
        },
        userProfile: { emailAddress: CONTEXT.accountEmail },
      },
    },
  } as unknown as OfficeLike;
  return { office, replies };
}

let api: ApiClient;
let office: OfficeLike;
let replies: { htmlBody: string }[];

beforeEach(() => {
  api = makeApi();
  ({ office, replies } = makeOffice());
});

describe("generateAndInsertReply", () => {
  it("opens Outlook's reply form with the draft as HTML", async () => {
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "inserted",
    });
    expect(replies).toEqual([{ htmlBody: "<p>Thursday works.</p>" }]);
  });

  it("sends the conversation id exactly as Outlook gave it", async () => {
    // The EWS/Graph alphabet difference is normalized server-side so this pane
    // and the Gmail content script cannot drift; the pane must not pre-mangle it.
    await generateAndInsertReply(api, office, CONTEXT);
    expect(api.generateDraftByProviderThread).toHaveBeenCalledWith("ws-1", "AAQkAD+bc/de");
  });

  it("reports when the mailbox belongs to no workspace, without drafting", async () => {
    api = makeApi({
      gmailConnection: vi.fn().mockResolvedValue({ gmailAddress: "someone@else.com" }),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "noWorkspace",
    });
    expect(api.generateDraftByProviderThread).not.toHaveBeenCalled();
  });

  it("resolves an Outlook mailbox through the provider-agnostic connection lookup", async () => {
    api = makeApi({
      gmailConnection: vi
        .fn()
        .mockResolvedValue({ provider: "OUTLOOK", gmailAddress: "ada@example.com" }),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "inserted",
    });
  });

  it("reports a quota refusal with the numbers the pane shows", async () => {
    api = makeApi({
      generateDraftByProviderThread: vi.fn().mockResolvedValue({
        quotaExceeded: true,
        used: 3,
        limit: 3,
        resetsAt: "2026-08-01T00:00:00Z",
      }),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "quota",
      used: 3,
      limit: 3,
      resetsAt: "2026-08-01T00:00:00Z",
    });
    expect(replies).toHaveLength(0);
  });

  it("reports an unsorted thread so the user knows to retry", async () => {
    api = makeApi({
      generateDraftByProviderThread: vi.fn().mockResolvedValue({ notClassified: true }),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "notSorted",
    });
  });

  it("distinguishes the workspace kill-switch from a failure", async () => {
    api = makeApi({
      generateDraftByProviderThread: vi
        .fn()
        .mockRejectedValue(new InjectionDisabledError("disabled")),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "injectionDisabled",
    });
  });

  it("distinguishes a never-synced conversation from a real error", async () => {
    api = makeApi({
      generateDraftByProviderThread: vi.fn().mockRejectedValue(new Error("Thread not found")),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({
      kind: "noThread",
    });

    api = makeApi({
      generateDraftByProviderThread: vi.fn().mockRejectedValue(new Error("API returned 500")),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({ kind: "error" });
  });

  it("errors when workspace resolution itself fails", async () => {
    api = makeApi({ workspaces: vi.fn().mockRejectedValue(new Error("offline")) });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({ kind: "error" });
  });

  it("waits out a concurrent generation and inserts the draft it produced", async () => {
    // The ribbon deep link auto-starts, so a second click routinely races the
    // first. Parity with the extension's draftHandler, which polls the same way.
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ generating: true })
      .mockResolvedValueOnce({ generating: true })
      .mockResolvedValue({ draft: DRAFT, isNew: false });
    api = makeApi({ generateDraftByProviderThread: generate });

    await expect(
      generateAndInsertReply(api, office, CONTEXT, testClock()),
    ).resolves.toEqual({ kind: "inserted" });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(replies).toHaveLength(1);
  });

  it("gives up on a generation that never lands, without opening a reply", async () => {
    const generate = vi.fn().mockResolvedValue({ generating: true });
    api = makeApi({ generateDraftByProviderThread: generate });

    await expect(
      generateAndInsertReply(api, office, CONTEXT, testClock()),
    ).resolves.toEqual({ kind: "error" });
    // 30s budget at a 2s interval, bounded rather than spinning forever.
    expect(generate.mock.calls.length).toBeGreaterThan(1);
    expect(generate.mock.calls.length).toBeLessThanOrEqual(16);
    expect(replies).toHaveLength(0);
  });

  it("does not poll a thread that has not been sorted yet", async () => {
    const generate = vi.fn().mockResolvedValue({ notClassified: true });
    api = makeApi({ generateDraftByProviderThread: generate });

    await expect(
      generateAndInsertReply(api, office, CONTEXT, testClock()),
    ).resolves.toEqual({ kind: "notSorted" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not open an empty reply form when the draft body is blank", async () => {
    api = makeApi({
      generateDraftByProviderThread: vi
        .fn()
        .mockResolvedValue({ draft: { ...DRAFT, body: "   " }, isNew: true }),
    });
    await expect(generateAndInsertReply(api, office, CONTEXT)).resolves.toEqual({ kind: "error" });
    expect(replies).toHaveLength(0);
  });

  it("errors when Outlook has no item to reply to", async () => {
    const empty = { context: { mailbox: {} } } as unknown as OfficeLike;
    await expect(generateAndInsertReply(api, empty, CONTEXT)).resolves.toEqual({ kind: "error" });
  });
});
