// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ApiClient } from "@amarnai/api-client";
import { ThreadCommentsSection } from "./ThreadCommentsSection.js";

// The web/extension comments widget: collapsed by default to one line between
// the summary and the message list. Collapsed it must stay cheap (meta fetch
// only, never the list) while still surfacing unread activity; expanding is
// what loads the list and advances the read marker.

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

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

function renderSection(api: ApiClient = makeApi()) {
  render(
    <I18nProvider i18n={i18n}>
      <ThreadCommentsSection
        api={api}
        workspaceId="ws-1"
        threadId="t1"
        currentUserId="u-me"
        members={[]}
      />
    </I18nProvider>,
  );
  return api;
}

describe("ThreadCommentsSection", () => {
  it("starts collapsed to a single header line: meta fetched, list never", async () => {
    const api = renderSection();

    await waitFor(() => expect(api.threadCommentsMeta).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("(3)")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /Comments/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Nothing but the header renders while collapsed.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(api.listThreadComments).not.toHaveBeenCalled();
    expect(api.markThreadCommentsRead).not.toHaveBeenCalled();
  });

  it("shows the unread chip from meta while collapsed", async () => {
    renderSection(
      makeApi({
        threadCommentsMeta: vi.fn().mockResolvedValue({ total: 3, unread: 2 }),
      } as Partial<ApiClient>),
    );

    expect(await screen.findByText("2 new")).toBeTruthy();
  });

  it("expanding loads the list, shows the composer, and marks read", async () => {
    const api = renderSection();

    fireEvent.click(screen.getByRole("button", { name: /Comments/ }));

    await waitFor(() => expect(api.listThreadComments).toHaveBeenCalledWith("ws-1", "t1"));
    await waitFor(() => expect(api.markThreadCommentsRead).toHaveBeenCalledWith("ws-1", "t1"));
    expect(screen.getByRole("button", { name: /Comments/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(await screen.findByRole("textbox")).toBeTruthy();
  });

  it("collapses back to one line on a second click", async () => {
    const api = renderSection();

    const toggle = screen.getByRole("button", { name: /Comments/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.listThreadComments).toHaveBeenCalled());
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
