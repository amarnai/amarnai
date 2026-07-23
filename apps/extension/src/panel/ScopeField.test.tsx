import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ActiveSelection, FolderItem } from "@amarnai/ui/emails";
import { ScopeField } from "./ScopeField";

// The scope field is the panel's only always-visible navigation control, so
// the invariants under test are behavioural: what it displays per scope kind,
// and that every path out of it (picker row, "All mail" top row, ancestor
// crumb) commits the right ActiveSelection.

i18n.load("en", {});
i18n.activate("en");

// Vitest runs without globals here, so testing-library's automatic afterEach
// cleanup never registers; without this, renders accumulate across tests.
afterEach(cleanup);

const FOLDERS: FolderItem[] = [
  { id: "f1", name: "Finance", description: null, parentId: null, ignored: false },
  { id: "f2", name: "Invoices", description: null, parentId: "f1", ignored: false },
];

const COUNTS = new Map<string, number>([["f1", 212], ["f2", 64]]);

function renderField(
  active: ActiveSelection,
  onSelect = vi.fn(),
  { total = 1284, onQueryChange = vi.fn(), query = "" } = {},
) {
  render(
    <I18nProvider i18n={i18n}>
      <ScopeField
        folders={FOLDERS}
        active={active}
        total={total}
        allCount={1284}
        assignedCount={7}
        folderCounts={COUNTS}
        query={query}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
      />
    </I18nProvider>,
  );
  return onSelect;
}

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Switch folder view" }));
}

describe("ScopeField", () => {
  it("shows 'All mail' and the formatted total for the all queue, picker closed", () => {
    renderField({ kind: "queue", id: "all" });
    expect(screen.getByText("All mail")).toBeTruthy();
    expect(screen.getByText("1,284")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Jump to folder…")).toBeNull();
  });

  it("opens the picker and commits a folder selection", () => {
    const onSelect = renderField({ kind: "queue", id: "all" });
    openPicker();
    expect(screen.getByPlaceholderText("Jump to folder…")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Invoices/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "folder", id: "f2" });
  });

  it("shows per-folder thread counts on the picker rows", () => {
    renderField({ kind: "queue", id: "all" });
    openPicker();
    // Folder rows carry their server total; the "All mail" row carries allCount.
    expect(screen.getByRole("option", { name: /Invoices/ }).textContent).toContain("64");
    expect(screen.getByRole("option", { name: /Finance/ }).textContent).toContain("212");
  });

  it("expands the search input and relays typing, then clears on close", () => {
    const onQueryChange = vi.fn();
    renderField({ kind: "queue", id: "all" }, vi.fn(), { onQueryChange, query: "stripe" });
    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    const input = screen.getByPlaceholderText("Search threads");
    fireEvent.change(input, { target: { value: "invoice" } });
    expect(onQueryChange).toHaveBeenCalledWith("invoice");
    // Closing a non-empty search resets the query.
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("pins an 'All mail' row in the picker that commits the all queue", () => {
    const onSelect = renderField({ kind: "folder", id: "f2" });
    openPicker();
    fireEvent.mouseDown(screen.getByRole("option", { name: /All mail/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "queue", id: "all" });
  });

  it("pins an 'Assigned' row with its count that commits the assigned queue", () => {
    const onSelect = renderField({ kind: "queue", id: "all" });
    openPicker();
    const row = screen.getByRole("option", { name: /Assigned/ });
    expect(row.textContent).toContain("7");
    fireEvent.mouseDown(row);
    expect(onSelect).toHaveBeenCalledWith({ kind: "queue", id: "assigned" });
  });

  it("labels the field with the queue name when the assigned queue is active", () => {
    renderField({ kind: "queue", id: "assigned" });
    expect(screen.getByText("Assigned")).toBeTruthy();
  });

  it("renders folder ancestry as crumbs that navigate up on tap", () => {
    const onSelect = renderField({ kind: "folder", id: "f2" });
    // Leaf in the main button, ancestors as crumb buttons.
    expect(screen.getByText("Invoices")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finance" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "folder", id: "f1" });
  });

  it("routes the root crumb to the all queue", () => {
    const onSelect = renderField({ kind: "folder", id: "f2" });
    fireEvent.click(screen.getByRole("button", { name: "All mail" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "queue", id: "all" });
  });
});
