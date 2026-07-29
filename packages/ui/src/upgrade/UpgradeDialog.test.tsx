// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { UpgradeDialog, type UpgradeDialogProps, type StartCheckoutOutcome } from "./UpgradeDialog.js";

i18n.load("en", {});
i18n.activate("en");

// Vitest runs without globals here, so testing-library's automatic afterEach
// cleanup never registers; without this, renders accumulate across tests.
afterEach(cleanup);

function ok(data: StartCheckoutOutcome["data"]): StartCheckoutOutcome {
  return { ok: true, status: 200, data };
}

function renderDialog(overrides: Partial<UpgradeDialogProps> = {}) {
  const props: UpgradeDialogProps = {
    workspaceId: "ws-1",
    workspaceName: "Acme",
    mascotSrc: "/aziru-upgrade.png",
    currentPlan: "FREE",
    startCheckout: vi.fn().mockResolvedValue(ok({ url: "https://stripe.test/c", sessionId: "cs_1" })),
    onCheckoutStarted: vi.fn(),
    onUpgraded: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };

  render(
    <I18nProvider i18n={i18n}>
      <UpgradeDialog {...props} />
    </I18nProvider>
  );

  return props;
}

describe("UpgradeDialog — which plans are offered", () => {
  it("offers every paid plan to a free workspace, and never Free itself", () => {
    renderDialog({ currentPlan: "FREE" });

    expect(screen.getByText("Scribe")).toBeTruthy();
    expect(screen.getByText("Pharaoh")).toBeTruthy();
    expect(screen.queryByText("Apprentice")).toBeNull();
  });

  it("hides the tier the workspace is already on", () => {
    renderDialog({ currentPlan: "PRO" });

    expect(screen.queryByText("Scribe")).toBeNull();
    expect(screen.getByText("Pharaoh")).toBeTruthy();
  });

  it("says so when there is nothing higher to move to", () => {
    renderDialog({ currentPlan: "BUSINESS" });

    expect(screen.getByText(/already on the highest plan/i)).toBeTruthy();
  });

  it("offers every paid plan again once a new workspace is the target", () => {
    renderDialog({ currentPlan: "PRO" });
    fireEvent.click(screen.getByRole("switch"));

    // A brand-new workspace starts at Free, so the current tier no longer limits
    // the choice.
    expect(screen.getByText("Scribe")).toBeTruthy();
  });
});

describe("UpgradeDialog — starting a checkout", () => {
  it("hands the host the session to open", async () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(props.onCheckoutStarted).toHaveBeenCalledWith({
        sessionId: "cs_1",
        url: "https://stripe.test/c",
      });
    });
    expect(props.startCheckout).toHaveBeenCalledWith({
      action: "upgrade",
      plan: "pro",
      cycle: "monthly",
      workspaceId: "ws-1",
    });
  });

  it("sends the selected billing cycle", async () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /annual/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(props.startCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: "annual" })
      );
    });
  });

  it("creates a new workspace by name instead of upgrading this one", async () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText(/new workspace name/i), {
      target: { value: "  Agency  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(props.startCheckout).toHaveBeenCalledWith({
        action: "create",
        plan: "pro",
        cycle: "monthly",
        newWorkspaceName: "Agency",
      });
    });
  });

  it("asks for a name before creating a workspace", async () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/name for the new workspace/i);
    });
    expect(props.startCheckout).not.toHaveBeenCalled();
  });
});

describe("UpgradeDialog — responses that need no payment step", () => {
  it("reports a paid-to-paid change applied directly, with no checkout to open", async () => {
    const props = renderDialog({
      currentPlan: "PRO",
      startCheckout: vi.fn().mockResolvedValue(ok({ upgraded: true })),
    });

    fireEvent.click(screen.getByRole("button", { name: /choose pharaoh/i }));

    await waitFor(() => expect(props.onUpgraded).toHaveBeenCalled());
    expect(props.onCheckoutStarted).not.toHaveBeenCalled();
    // The same success card the web app shows, mascot and all.
    expect(screen.getByText(/payment confirmed/i)).toBeTruthy();
    expect(screen.getByText(/You're on Pharaoh/i)).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
  });
});

describe("UpgradeDialog — failures", () => {
  it("shows what the server actually refused, not a guess at why", async () => {
    const props = renderDialog({
      startCheckout: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        data: { error: "Email not verified" },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    // Reporting every 403 as an ownership problem sent people hunting for
    // permissions they already had.
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/email not verified/i);
    });
    expect(props.onCheckoutStarted).not.toHaveBeenCalled();
  });

  it("falls back to a permission message when a 403 carries no reason", async () => {
    renderDialog({
      startCheckout: vi.fn().mockResolvedValue({ ok: false, status: 403, data: {} }),
    });

    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/do not have permission/i);
    });
  });

  it("surfaces the server's message for other refusals", async () => {
    renderDialog({
      startCheckout: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        data: { error: "Cannot downgrade via this endpoint" },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/cannot downgrade/i);
    });
  });

  it("reports an unreachable billing service", async () => {
    renderDialog({ startCheckout: vi.fn().mockRejectedValue(new Error("offline")) });

    fireEvent.click(screen.getByRole("button", { name: /choose scribe/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/could not reach/i);
    });
  });
});

describe("UpgradeDialog — downgrade stays in subscription settings", () => {
  it("offers no way to downgrade or cancel from the panel", () => {
    renderDialog({ currentPlan: "PRO" });

    expect(screen.queryByText(/cancel subscription/i)).toBeNull();
    expect(screen.queryByText(/downgrade/i)).toBeNull();
    expect(screen.getByText(/done in your subscription settings/i)).toBeTruthy();
  });
});
