// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ApiClient, GmailSyncSettings } from "@amarnai/api-client";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";
import { PlanSection } from "./PlanSection.js";
import { WorkspaceNameSection } from "./WorkspaceNameSection.js";
import { WorkspaceLanguageSection } from "./WorkspaceLanguageSection.js";
import { GmailSyncSettingsSection } from "./GmailSyncSettingsSection.js";
import { LabelWritebackSection } from "./LabelWritebackSection.js";

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

const settings: GmailSyncSettings = { ...DEFAULT_GMAIL_SYNC_SETTINGS };

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    updateWorkspace: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
      id: "ws-1",
      name: (patch["name"] as string) ?? "Acme",
      locale: (patch["locale"] as string) ?? "en",
    })),
    updateGmailSyncSettings: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
      ...settings,
      ...patch,
    })),
    sweepInbox: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as unknown as ApiClient;
}

function wrap(ui: React.ReactElement) {
  render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);
}

describe("WorkspaceNameSection", () => {
  it("saves the trimmed name and tells the host", async () => {
    const api = makeApi();
    const onSaved = vi.fn();
    wrap(
      <WorkspaceNameSection api={api} workspaceId="ws-1" currentName="Acme" onSaved={onSaved} />
    );

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "  Acme Ltd  " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(api.updateWorkspace).toHaveBeenCalledWith("ws-1", { name: "Acme Ltd" })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Acme Ltd"));
  });

  it("does not offer to save an unchanged name", () => {
    wrap(<WorkspaceNameSection api={makeApi()} workspaceId="ws-1" currentName="Acme" />);

    expect(screen.getByRole("button", { name: /save/i }).hasAttribute("disabled")).toBe(true);
  });

  it("reports a failure without claiming the name was saved", async () => {
    const api = makeApi({
      updateWorkspace: vi.fn(async () => {
        throw new Error("Name already taken");
      }),
    });
    wrap(<WorkspaceNameSection api={api} workspaceId="ws-1" currentName="Acme" />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already taken/i));
    expect(screen.queryByText(/updated/i)).toBeNull();
  });
});

describe("WorkspaceLanguageSection", () => {
  it("saves the locale and lets the host re-activate it", async () => {
    const api = makeApi();
    const onChanged = vi.fn();
    wrap(
      <WorkspaceLanguageSection
        api={api}
        workspaceId="ws-1"
        currentLocale="en"
        onChanged={onChanged}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fr" } });

    await waitFor(() =>
      expect(api.updateWorkspace).toHaveBeenCalledWith("ws-1", { locale: "fr" })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("fr"));
  });

  it("puts the picker back when the save fails", async () => {
    const api = makeApi({
      updateWorkspace: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    wrap(<WorkspaceLanguageSection api={api} workspaceId="ws-1" currentLocale="en" />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "fr" } });

    await waitFor(() => expect(select.value).toBe("en"));
  });
});

describe("GmailSyncSettingsSection", () => {
  it("persists a filter toggle", async () => {
    const api = makeApi();
    wrap(
      <GmailSyncSettingsSection
        api={api}
        workspaceId="ws-1"
        provider="GMAIL"
        initialSettings={settings}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: /include spam/i }));

    await waitFor(() =>
      expect(api.updateGmailSyncSettings).toHaveBeenCalledWith("ws-1", { includeSpam: true })
    );
  });

  it("hides the Gmail-only Promotions filter for Outlook", () => {
    wrap(
      <GmailSyncSettingsSection
        api={makeApi()}
        workspaceId="ws-1"
        provider="OUTLOOK"
        initialSettings={settings}
      />
    );

    expect(screen.queryByRole("switch", { name: /promotions/i })).toBeNull();
    expect(screen.getByRole("switch", { name: /include spam/i })).toBeTruthy();
  });

  it("only offers a rescan once a filter actually changed", async () => {
    const api = makeApi();
    wrap(
      <GmailSyncSettingsSection
        api={api}
        workspaceId="ws-1"
        provider="GMAIL"
        initialSettings={settings}
      />
    );

    // Nothing to re-apply yet.
    expect(screen.getByRole("button", { name: /rescan/i }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: /include spam/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /rescan/i }).hasAttribute("disabled")).toBe(false)
    );

    fireEvent.click(screen.getByRole("button", { name: /rescan/i }));
    await waitFor(() => expect(api.sweepInbox).toHaveBeenCalledWith("ws-1"));
  });
});

describe("LabelWritebackSection", () => {
  it("shows off, and asks for permission first, when the scope is missing", async () => {
    const api = makeApi();
    const onRequestWriteScope = vi.fn();
    wrap(
      <LabelWritebackSection
        api={api}
        workspaceId="ws-1"
        provider="GMAIL"
        initialEnabled
        hasWriteScope={false}
        onRequestWriteScope={onRequestWriteScope}
      />
    );

    // Enabled in the database but inert without the grant, so it must not read
    // as on.
    const toggle = screen.getByRole("switch");
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);

    expect(onRequestWriteScope).toHaveBeenCalled();
    // Nothing is written until the grant exists.
    expect(api.updateGmailSyncSettings).not.toHaveBeenCalled();
  });

  it("writes the setting directly when the scope is present", async () => {
    const api = makeApi();
    wrap(
      <LabelWritebackSection
        api={api}
        workspaceId="ws-1"
        provider="GMAIL"
        initialEnabled
        hasWriteScope
        onRequestWriteScope={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(api.updateGmailSyncSettings).toHaveBeenCalledWith("ws-1", {
        labelWritebackEnabled: false,
      })
    );
  });

  it("uses Outlook's vocabulary for an Outlook mailbox", () => {
    wrap(
      <LabelWritebackSection
        api={makeApi()}
        workspaceId="ws-1"
        provider="OUTLOOK"
        initialEnabled
        hasWriteScope
        onRequestWriteScope={vi.fn()}
      />
    );

    expect(screen.getByText(/categories in outlook/i)).toBeTruthy();
    expect(screen.queryByText(/labels in gmail/i)).toBeNull();
  });
});

describe("PlanSection", () => {
  it("names the current plan and offers an upgrade to the owner", () => {
    const onUpgrade = vi.fn();
    wrap(<PlanSection plan="FREE" billingEnabled isOwner onUpgrade={onUpgrade} />);

    expect(screen.getByText(/Apprentice/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /upgrade/i }));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("offers nothing to buy on a deployment without billing", () => {
    wrap(<PlanSection plan="FREE" billingEnabled={false} isOwner onUpgrade={vi.fn()} />);

    // Self-hosted without Stripe: an upgrade could only end in a failed checkout.
    expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
    expect(screen.getByText(/Apprentice/)).toBeTruthy();
  });

  it("points a non-owner at the owner instead of a button that would be refused", () => {
    wrap(<PlanSection plan="FREE" billingEnabled isOwner={false} onUpgrade={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
    expect(screen.getByText(/ask the workspace owner/i)).toBeTruthy();
  });

  it("offers no upgrade from the top plan", () => {
    wrap(<PlanSection plan="BUSINESS" billingEnabled isOwner onUpgrade={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
    expect(screen.getByText(/Pharaoh/)).toBeTruthy();
  });
});
