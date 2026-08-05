import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ApiClient } from "@amarnai/api-client";
import { CommentsSection } from "./CommentsSection.js";
import type { PanelHost } from "./host.js";
import type { EmailThreadDetail } from "./types.js";

// The section's header is the panel's "comment button": collapsed it must stay
// cheap (a meta fetch only, never the list), and its pill must surface unread
// activity; expanding — by click or by the ?focus=comments deep link — is what
// loads the list and advances the read marker.

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

beforeEach(() => {
  // jsdom has no scrollIntoView; the focus path calls it on the section.
  Element.prototype.scrollIntoView = vi.fn();
});

const THREAD = { id: "t1", subject: "Kickoff" } as unknown as EmailThreadDetail;

const HOST = {
  tokenStore: { get: vi.fn().mockResolvedValue(null) },
} as unknown as PanelHost;

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    threadCommentsMeta: vi.fn().mockResolvedValue({ total: 3, unread: 0 }),
    listThreadComments: vi.fn().mockResolvedValue({ comments: [], lastReadAt: null }),
    markThreadCommentsRead: vi
      .fn()
      .mockResolvedValue({ ok: true, lastReadAt: "2026-08-05T10:00:00.000Z" }),
    createThreadComment: vi.fn(),
    deleteThreadComment: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

function renderSection(opts: { api?: ApiClient; focus?: boolean } = {}) {
  const api = opts.api ?? makeApi();
  render(
    <I18nProvider i18n={i18n}>
      <CommentsSection
        api={api}
        host={HOST}
        workspaceId="ws-1"
        thread={THREAD}
        members={[]}
        focus={opts.focus ?? false}
      />
    </I18nProvider>,
  );
  return { api };
}

describe("CommentsSection", () => {
  it("starts collapsed: fetches the meta counts but never the list", async () => {
    const { api } = renderSection();

    await waitFor(() => expect(api.threadCommentsMeta).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("3")).toBeTruthy();
    expect(api.listThreadComments).not.toHaveBeenCalled();
    expect(api.markThreadCommentsRead).not.toHaveBeenCalled();
  });

  it("shows the accent unread pill while collapsed", async () => {
    const api = makeApi({
      threadCommentsMeta: vi.fn().mockResolvedValue({ total: 3, unread: 2 }),
    } as Partial<ApiClient>);
    renderSection({ api });

    const pill = await screen.findByText("2 new");
    expect(pill.className).toContain("apn-queue-count--new");
  });

  it("expanding loads the list and advances the read marker", async () => {
    const { api } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: /Comments/ }));

    await waitFor(() => expect(api.listThreadComments).toHaveBeenCalledWith("ws-1", "t1"));
    await waitFor(() => expect(api.markThreadCommentsRead).toHaveBeenCalledWith("ws-1", "t1"));
  });

  it("mounts expanded when deep-linked with focus", async () => {
    const { api } = renderSection({ focus: true });

    await waitFor(() => expect(api.listThreadComments).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /Comments/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});
