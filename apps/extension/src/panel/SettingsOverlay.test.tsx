import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ApiClient, Workspace } from "@amarnai/api-client";
import { DEFAULT_GMAIL_SYNC_SETTINGS } from "@amarnai/shared";

// Ownership has two representations in the schema: Workspace.ownerUserId and
// WorkspaceMember.role. Every server check behind these controls reads the role,
// so this gate must too — reading the other one renders controls the server then
// refuses, which is how "Only the workspace owner can change the plan" reached a
// user who owned the workspace.

const session = vi.hoisted(() => ({
  workspaces: [] as Workspace[],
  userId: "u-1" as string | null,
  refreshWorkspaces: vi.fn(),
}));

vi.mock("../auth/session", () => ({ useSession: () => session }));
vi.mock("./openWebApp", () => ({
  openWebApp: vi.fn(),
  useWebAppLink: () => (path: string) => ({
    href: path,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: vi.fn(),
  }),
}));

import { SettingsOverlay } from "./SettingsOverlay";
import { openWebApp } from "./openWebApp";

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

function workspace(members: Array<{ userId: string; role: string }>): Workspace {
  return {
    id: "ws-1",
    name: "Acme",
    locale: "en",
    plan: "FREE",
    createdAt: "",
    updatedAt: "",
    // Deliberately points at a user who is NOT an OWNER member below, so a gate
    // reading this field instead of the role would wrongly grant access.
    owner: { id: "u-1", email: "a@b.com", name: null },
    members: members.map((m, i) => ({
      id: `m-${i}`,
      role: m.role,
      user: { id: m.userId, email: `${m.userId}@b.com`, name: null },
    })),
  } as Workspace;
}

function makeApi(): ApiClient {
  return {
    gmailSyncSettings: vi.fn(async () => ({
      ...DEFAULT_GMAIL_SYNC_SETTINGS,
      writebackAvailable: false,
      hasWritebackScope: false,
    })),
    gmailConnection: vi.fn(async () => null),
    syncStatus: vi.fn(async () => null),
  } as unknown as ApiClient;
}

function renderOverlay(api: ApiClient = makeApi()) {
  render(
    <I18nProvider i18n={i18n}>
      <SettingsOverlay
        api={api}
        workspaceId="ws-1"
        onUpgrade={vi.fn()}
        onClose={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("SettingsOverlay — which controls a member sees", () => {
  it("shows the owner-only controls to an OWNER member", async () => {
    session.workspaces = [workspace([{ userId: "u-1", role: "OWNER" }])];
    session.userId = "u-1";

    renderOverlay();

    await waitFor(() => expect(screen.getByText(/workspace details/i)).toBeTruthy());
    expect(screen.getByText(/^Language$/)).toBeTruthy();
    expect(screen.getByText(/invite collaborators/i)).toBeTruthy();
  });

  it("hides them from a plain member even when ownerUserId points at them", async () => {
    // ownerUserId says u-1 but the membership role says MEMBER. The server
    // enforces the role, so the controls must not render.
    session.workspaces = [workspace([{ userId: "u-1", role: "MEMBER" }])];
    session.userId = "u-1";

    renderOverlay();

    // The plan section always renders, so wait on that before asserting absence.
    await waitFor(() => expect(screen.getByText(/^Plan$/)).toBeTruthy());
    expect(screen.queryByText(/workspace details/i)).toBeNull();
    expect(screen.queryByText(/invite collaborators/i)).toBeNull();
    expect(screen.queryByText(/^Language$/)).toBeNull();
  });

  it("hides them from someone with no membership row", async () => {
    session.workspaces = [workspace([{ userId: "someone-else", role: "OWNER" }])];
    session.userId = "u-1";

    renderOverlay();

    await waitFor(() => expect(screen.getByText(/^Plan$/)).toBeTruthy());
    expect(screen.queryByText(/workspace details/i)).toBeNull();
    expect(screen.queryByText(/invite collaborators/i)).toBeNull();
  });
});

// The panel cannot run OAuth itself, so a workspace whose mailbox predates the
// write scope has to finish the grant on the web. Sending it to the bare
// settings page made the switch look broken: the click opened a tab and the
// toggle stayed off, with nothing saying why.
describe("SettingsOverlay — label writeback without the write scope", () => {
  /** An owner with an active mailbox, writeback available but not yet granted. */
  function makeWritebackApi(hasWritebackScope: boolean): ApiClient {
    return {
      gmailSyncSettings: vi.fn(async () => ({
        ...DEFAULT_GMAIL_SYNC_SETTINGS,
        labelWritebackEnabled: true,
        writebackAvailable: true,
        hasWritebackScope,
      })),
      gmailConnection: vi.fn(async () => ({ provider: "GMAIL", status: "ACTIVE" })),
      syncStatus: vi.fn(async () => null),
    } as unknown as ApiClient;
  }

  function writebackSwitch(): HTMLInputElement {
    const label = screen.getByText(/write sorted folders as gmail labels/i).closest("label");
    return label!.querySelector("input[role=switch]") as HTMLInputElement;
  }

  it("sends the user into the consent flow, not just to the settings page", async () => {
    session.workspaces = [workspace([{ userId: "u-1", role: "OWNER" }])];
    session.userId = "u-1";

    renderOverlay(makeWritebackApi(false));

    await waitFor(() => expect(writebackSwitch()).toBeTruthy());
    // Stored setting is on, but the missing scope makes it inert, so it reads off.
    expect(writebackSwitch().checked).toBe(false);

    fireEvent.click(writebackSwitch());

    expect(vi.mocked(openWebApp)).toHaveBeenCalledWith(
      expect.anything(),
      "/settings?writeback=connect"
    );
  });

  it("shows the switch on once the grant made in another tab comes back", async () => {
    session.workspaces = [workspace([{ userId: "u-1", role: "OWNER" }])];
    session.userId = "u-1";

    // First read has neither the scope nor the setting. The web consent flow
    // grants the scope AND turns the setting on, so every later read has both.
    let granted = false;
    const api = {
      gmailSyncSettings: vi.fn(async () => ({
        ...DEFAULT_GMAIL_SYNC_SETTINGS,
        labelWritebackEnabled: granted,
        writebackAvailable: true,
        hasWritebackScope: granted,
      })),
      gmailConnection: vi.fn(async () => ({ provider: "GMAIL", status: "ACTIVE" })),
      syncStatus: vi.fn(async () => null),
    } as unknown as ApiClient;

    renderOverlay(api);

    await waitFor(() => expect(writebackSwitch()).toBeTruthy());
    expect(writebackSwitch().checked).toBe(false);

    granted = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(writebackSwitch().checked).toBe(true));
  });
});
