import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { UpgradeSuccessOverlay } from "./UpgradeSuccessOverlay";

// A checkout that ran in a tab has no dialog left to report into, so this is the
// only place the user is told what they bought.

i18n.load("en", {});
i18n.activate("en");
afterEach(cleanup);

function renderOverlay(overrides: Partial<Parameters<typeof UpgradeSuccessOverlay>[0]> = {}) {
  const props = {
    plan: "BUSINESS",
    purchasedWorkspaceId: "ws-1",
    purchasedWorkspaceName: "Acme",
    currentWorkspaceId: "ws-1",
    onSwitchWorkspace: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider i18n={i18n}>
      <UpgradeSuccessOverlay {...props} />
    </I18nProvider>
  );
  return props;
}

describe("UpgradeSuccessOverlay — the workspace the user is in", () => {
  it("names the plan they just bought", () => {
    renderOverlay();

    expect(screen.getByText(/payment confirmed/i)).toBeTruthy();
    expect(screen.getByText(/You're on Pharaoh/i)).toBeTruthy();
    expect(screen.getByText(/new limits apply right away/i)).toBeTruthy();
  });

  it("offers no workspace switch, because there is nowhere to go", () => {
    renderOverlay();

    expect(screen.queryByRole("button", { name: /switch to it/i })).toBeNull();
  });

  it("dismisses", () => {
    const props = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    expect(props.onDone).toHaveBeenCalled();
  });
});

describe("UpgradeSuccessOverlay — a plan bought for another workspace", () => {
  it("says where the plan landed instead of implying it applies here", () => {
    renderOverlay({
      purchasedWorkspaceId: "ws-2",
      purchasedWorkspaceName: "Agency",
      currentWorkspaceId: "ws-1",
    });

    expect(screen.getByText(/Agency is on Pharaoh/i)).toBeTruthy();
    // Claiming "you're on Pharaoh" would be false of the workspace on screen.
    expect(screen.queryByText(/You're on Pharaoh/i)).toBeNull();
    expect(screen.getByText(/This workspace is unchanged/i)).toBeTruthy();
  });

  it("offers to switch to it", () => {
    const props = renderOverlay({
      purchasedWorkspaceId: "ws-2",
      purchasedWorkspaceName: "Agency",
      currentWorkspaceId: "ws-1",
    });

    fireEvent.click(screen.getByRole("button", { name: /switch to it/i }));

    expect(props.onSwitchWorkspace).toHaveBeenCalledWith("ws-2");
  });
});
