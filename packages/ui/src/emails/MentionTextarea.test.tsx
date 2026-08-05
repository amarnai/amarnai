// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { MentionTextarea } from "./MentionTextarea.js";
import type { MemberItem } from "./types.js";

// The @-mention composer's contract: typing @ opens a filtered member list,
// keyboard selection inserts `@Name ` while focus never leaves the textarea,
// and every token that resolves to a member — picker-inserted or hand-typed —
// renders in the accent highlight layer.

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

const MEMBERS: MemberItem[] = [
  { userId: "u-alice", name: "Alice", email: "alice@example.com" },
  { userId: "u-bob", name: "Bob", email: "bob@example.com" },
];

function Harness({ members }: { members: MemberItem[] | null }) {
  const [value, setValue] = useState("");
  return (
    <I18nProvider i18n={i18n}>
      <MentionTextarea value={value} onChange={setValue} members={members} />
    </I18nProvider>
  );
}

function textarea(): HTMLTextAreaElement {
  return document.querySelector("textarea")!;
}

function highlightedTags(): string[] {
  return Array.from(document.querySelectorAll(".em-comment-highlight-mention")).map(
    (el) => el.textContent ?? "",
  );
}

describe("MentionTextarea", () => {
  it("opens the member popover on @ and filters on the typed query", () => {
    render(<Harness members={MEMBERS} />);

    fireEvent.change(textarea(), { target: { value: "@" } });
    expect(screen.getByRole("option", { name: "Alice" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bob" })).toBeTruthy();

    fireEvent.change(textarea(), { target: { value: "@al" } });
    expect(screen.getByRole("option", { name: "Alice" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Bob" })).toBeNull();
  });

  it("inserts the selection as @Name and highlights it", () => {
    render(<Harness members={MEMBERS} />);

    fireEvent.change(textarea(), { target: { value: "ping @b" } });
    fireEvent.keyDown(textarea(), { key: "Enter" });

    expect(textarea().value).toBe("ping @Bob ");
    expect(highlightedTags()).toEqual(["@Bob"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("navigates with the arrow keys without leaving the textarea", () => {
    render(<Harness members={MEMBERS} />);

    fireEvent.change(textarea(), { target: { value: "@" } });
    fireEvent.keyDown(textarea(), { key: "ArrowDown" });
    fireEvent.keyDown(textarea(), { key: "Enter" });

    expect(textarea().value).toBe("@Bob ");
    expect(highlightedTags()).toEqual(["@Bob"]);
  });

  it("highlights a hand-typed valid tag and ignores an invalid one", () => {
    render(<Harness members={MEMBERS} />);

    fireEvent.change(textarea(), { target: { value: "ask @Alice or @Nobody" } });
    fireEvent.keyDown(textarea(), { key: "Escape" });

    expect(highlightedTags()).toEqual(["@Alice"]);
  });

  it("dismisses on Escape for the current token; a fresh @ re-arms", () => {
    render(<Harness members={MEMBERS} />);

    fireEvent.change(textarea(), { target: { value: "@" } });
    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    // Extending the dismissed token stays quiet — Escape meant "not here".
    fireEvent.change(textarea(), { target: { value: "@a" } });
    expect(screen.queryByRole("listbox")).toBeNull();

    // A new @ token elsewhere opens again.
    fireEvent.change(textarea(), { target: { value: "@a done @" } });
    expect(screen.getByRole("option", { name: "Alice" })).toBeTruthy();
  });

  it("shows nothing while the member list is still loading (null)", () => {
    render(<Harness members={null} />);

    fireEvent.change(textarea(), { target: { value: "@" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(highlightedTags()).toEqual([]);
  });

  it("shows the no-match row for a query nobody matches", () => {
    render(<Harness members={MEMBERS} />);

    fireEvent.change(textarea(), { target: { value: "@zzz" } });
    expect(screen.getByText("No matching members")).toBeTruthy();
  });
});
