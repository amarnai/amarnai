import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ApiClient } from "@amarnai/api-client";
import { DraftSection } from "./DraftSection.js";
import type { EmailThreadDetail } from "./types.js";

// A draft the user asks for from inside their mailbox is a request for the
// reply, not for a preview of it: it goes into the compose by itself. These
// tests pin that (it spends from the monthly allowance and writes into the
// user's compose window, so neither may happen by accident) and the states
// where it must NOT happen.

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

const THREAD = {
  id: "t1",
  subject: "Kickoff",
  triageStatus: "SORTED",
  messages: [{ id: "m1", senderEmail: "ada@example.com" }],
  isDrafting: false,
  hasDraft: false,
} as unknown as EmailThreadDetail;

const DRAFT = {
  id: "d1",
  status: "PROPOSED",
  subject: "Re: Kickoff",
  body: "Sounds good.",
  createdAt: "2026-07-29T10:00:00.000Z",
};

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    draftQuota: vi.fn().mockResolvedValue({
      used: 4,
      limit: 500,
      resetsAt: "2026-08-01T00:00:00.000Z",
    }),
    threadDrafts: vi.fn().mockResolvedValue({ drafts: [] }),
    generateDraft: vi.fn().mockResolvedValue({ draft: DRAFT, isNew: true }),
    toggleDraftSent: vi.fn().mockResolvedValue({ draft: { ...DRAFT, status: "SENT" } }),
    ...overrides,
  } as unknown as ApiClient;
}

function renderSection(
  opts: { api?: ApiClient; canInsert?: boolean; thread?: EmailThreadDetail } = {},
) {
  const insertDraft = vi.fn<(html: string) => Promise<boolean>>().mockResolvedValue(true);
  render(
    <I18nProvider i18n={i18n}>
      <DraftSection
        api={opts.api ?? makeApi()}
        workspaceId="ws-1"
        thread={opts.thread ?? THREAD}
        accountEmail="reader@example.com"
        canInsert={opts.canInsert ?? true}
        insertDraft={insertDraft}
      />
    </I18nProvider>,
  );
  return { insertDraft };
}

describe("DraftSection", () => {
  it("inserts the draft into the compose without a second click", async () => {
    const api = makeApi();
    const { insertDraft } = renderSection({ api });

    fireEvent.click(await screen.findByRole("button", { name: "Draft a reply" }));

    await waitFor(() => expect(insertDraft).toHaveBeenCalledTimes(1));
    expect(insertDraft.mock.calls[0]?.[0]).toContain("Sounds good.");
    // Inserting is what marks the draft — the panel offers no sent toggle.
    await waitFor(() =>
      expect(api.toggleDraftSent).toHaveBeenCalledWith("ws-1", "t1", "d1", true),
    );
    expect(screen.queryByRole("button", { name: /Mark as (un)?sent/ })).toBeNull();
  });

  it("inserts a draft that finishes on the poll, not in the response", async () => {
    const threadDrafts = vi
      .fn()
      .mockResolvedValueOnce({ drafts: [] }) // the initial restore
      .mockResolvedValue({ drafts: [DRAFT] }); // the poll
    const api = makeApi({
      threadDrafts,
      generateDraft: vi.fn().mockResolvedValue({ generating: true }),
    } as unknown as Partial<ApiClient>);
    const { insertDraft } = renderSection({ api });

    fireEvent.click(await screen.findByRole("button", { name: "Draft a reply" }));

    await waitFor(() => expect(insertDraft).toHaveBeenCalledTimes(1), { timeout: 5_000 });
  });

  it("does not insert a draft restored from a previous visit", async () => {
    const api = makeApi({ threadDrafts: vi.fn().mockResolvedValue({ drafts: [DRAFT] }) });
    const { insertDraft } = renderSection({ api });

    await screen.findByText("Sounds good.");
    expect(insertDraft).not.toHaveBeenCalled();
    expect(api.generateDraft).not.toHaveBeenCalled();
  });

  // Sorting is not a precondition for a draft: the server writes one from the
  // thread's own messages and simply omits the triage context. A PENDING thread
  // may never be sorted at all (QUOTA_BLOCKED waits for a month rollover), so
  // hiding the button here would make it permanently unreachable.
  it("offers a draft on an unsorted thread", async () => {
    const api = makeApi();
    const { insertDraft } = renderSection({
      api,
      thread: { ...THREAD, triageStatus: "PENDING" } as unknown as EmailThreadDetail,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Draft a reply" }));

    await waitFor(() => expect(insertDraft).toHaveBeenCalledTimes(1));
    expect(api.generateDraft).toHaveBeenCalledWith("ws-1", "t1", {});
  });

  it("leaves regeneration to the insert button", async () => {
    const api = makeApi({ threadDrafts: vi.fn().mockResolvedValue({ drafts: [DRAFT] }) });
    const { insertDraft } = renderSection({ api });

    fireEvent.click(await screen.findByRole("button", { name: /Regenerate/ }));

    await waitFor(() => expect(api.generateDraft).toHaveBeenCalledWith("ws-1", "t1", { force: true }));
    expect(insertDraft).not.toHaveBeenCalled();
  });
});
