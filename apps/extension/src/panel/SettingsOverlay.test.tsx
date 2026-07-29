import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("./openWebApp", () => ({ openWebApp: vi.fn() }));

import { SettingsOverlay } from "./SettingsOverlay";

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

function renderOverlay() {
  render(
    <I18nProvider i18n={i18n}>
      <SettingsOverlay
        api={makeApi()}
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
    expect(screen.queryByText(/^Language$/)).toBeNull();
  });

  it("hides them from someone with no membership row", async () => {
    session.workspaces = [workspace([{ userId: "someone-else", role: "OWNER" }])];
    session.userId = "u-1";

    renderOverlay();

    await waitFor(() => expect(screen.getByText(/^Plan$/)).toBeTruthy());
    expect(screen.queryByText(/workspace details/i)).toBeNull();
  });
});
