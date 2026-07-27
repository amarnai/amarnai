import { render, cleanup, screen, fireEvent } from "@/test-utils";
import { describe, it, expect, afterEach, vi } from "vitest";
import { ThreadSummaryCard } from "@amarnai/ui/emails";

// ThreadSummaryCard lives in packages/ui, which has no jsdom harness of its own;
// shared email components are exercised from here (see backfill-card.test.tsx).

afterEach(cleanup);

describe("ThreadSummaryCard", () => {
  it("shows a pulse and a summarizing label while loading", () => {
    const { container } = render(<ThreadSummaryCard state={{ kind: "loading" }} />);
    expect(container.querySelector(".em-summary-skeleton-pulse")).not.toBeNull();
    expect(screen.getByText(/summarizing/i)).toBeTruthy();
  });

  it("renders a generated summary under the Summary eyebrow", () => {
    render(<ThreadSummaryCard state={{ kind: "summary", text: "Ana needs the kickoff date." }} />);
    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByText("Ana needs the kickoff date.")).toBeTruthy();
  });

  it("labels a snippet as a Preview, not a Summary", () => {
    render(<ThreadSummaryCard state={{ kind: "snippet", text: "Your receipt is attached" }} />);
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.queryByText("Summary")).toBeNull();
  });

  it("renders nothing when the snippet is empty", () => {
    const { container } = render(<ThreadSummaryCard state={{ kind: "snippet", text: "" }} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when a summary comes back empty", () => {
    const { container } = render(<ThreadSummaryCard state={{ kind: "summary", text: "" }} />);
    expect(container.innerHTML).toBe("");
  });

  it("calls onRetry from the error state", () => {
    const onRetry = vi.fn();
    render(<ThreadSummaryCard state={{ kind: "error", onRetry }} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the reset date in the quota state", () => {
    render(
      <ThreadSummaryCard
        state={{ kind: "quota", quota: { used: 50, limit: 50, resetsAt: "2026-08-01T00:00:00.000Z" } }}
      />,
    );
    expect(screen.getByText(/no summaries remaining/i)).toBeTruthy();
    expect(screen.getByText(/Aug 1/)).toBeTruthy();
  });
});

describe("ThreadSummaryCard bullets", () => {
  it("renders one list item per bullet under the Summary eyebrow", () => {
    render(
      <ThreadSummaryCard
        state={{ kind: "bullets", bullets: ["Shabbat at 19:30", "Bring documents"] }}
      />,
    );
    expect(screen.getByText("Summary")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe("Shabbat at 19:30");
  });

  it("renders nothing for an empty bullet list", () => {
    const { container } = render(<ThreadSummaryCard state={{ kind: "bullets", bullets: [] }} />);
    expect(container.innerHTML).toBe("");
  });
});
