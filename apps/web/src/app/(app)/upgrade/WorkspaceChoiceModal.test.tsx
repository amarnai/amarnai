import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceChoiceModal } from "./WorkspaceChoiceModal";

const defaultProps = {
  workspaceId: "ws_123",
  workspaceName: "Acme Corp",
  plan: "pro" as const,
  cycle: "monthly" as const,
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkspaceChoiceModal", () => {
  describe("rendering", () => {
    it("shows the title", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      expect(
        screen.getByText("How do you want to use this plan?")
      ).toBeInTheDocument();
    });

    it("shows both options as buttons", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      expect(
        screen.getByRole("button", { name: /Upgrade this workspace/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Create a new workspace/ })
      ).toBeInTheDocument();
    });

    it("shows the current workspace name", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });

    it("shows the helper text", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      expect(
        screen.getByText(
          "You can keep your free Personal workspace and use paid workspaces separately."
        )
      ).toBeInTheDocument();
    });
  });

  describe("option selection", () => {
    it("Continue is disabled before any option is selected", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      expect(
        screen.getByRole("button", { name: /Continue to payment/ })
      ).toBeDisabled();
    });

    it("Continue is enabled after selecting upgrade", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Upgrade this workspace/ })
      );
      expect(
        screen.getByRole("button", { name: /Continue to payment/ })
      ).not.toBeDisabled();
    });

    it("marks the clicked option as selected", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      const btn = screen.getByRole("button", { name: /Upgrade this workspace/ });
      fireEvent.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "true");
    });

    it("switches selection when a different option is clicked", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Upgrade this workspace/ })
      );
      fireEvent.click(
        screen.getByRole("button", { name: /Create a new workspace/ })
      );
      expect(
        screen.getByRole("button", { name: /Upgrade this workspace/ })
      ).toHaveAttribute("aria-pressed", "false");
      expect(
        screen.getByRole("button", { name: /Create a new workspace/ })
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("shows name input when create is selected", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Create a new workspace/ })
      );
      expect(
        screen.getByPlaceholderText("New workspace name")
      ).toBeInTheDocument();
    });

    it("Continue is disabled when create is selected but name is empty", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Create a new workspace/ })
      );
      expect(
        screen.getByRole("button", { name: /Continue to payment/ })
      ).toBeDisabled();
    });

    it("Continue is enabled when create is selected and name is filled", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Create a new workspace/ })
      );
      fireEvent.change(screen.getByPlaceholderText("New workspace name"), {
        target: { value: "New Team Workspace" },
      });
      expect(
        screen.getByRole("button", { name: /Continue to payment/ })
      ).not.toBeDisabled();
    });
  });

  describe("checkout flow", () => {
    it("calls the checkout API with upgrade action and redirects", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/pay/cs_test" }),
      } as Response);

      const assignSpy = vi.fn();
      Object.defineProperty(window, "location", {
        value: { href: "", assign: assignSpy },
        writable: true,
      });

      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: /Upgrade this workspace/ }));
      fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
      const call = mockFetch.mock.calls[0]!;
      expect(call[0]).toBe("/api/billing/create-checkout-session");
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body).toMatchObject({
        action: "upgrade",
        plan: "pro",
        cycle: "monthly",
        workspaceId: "ws_123",
      });
    });

    it("calls the checkout API with create action and workspace name", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/pay/cs_test" }),
      } as Response);

      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: /Create a new workspace/ }));
      fireEvent.change(screen.getByPlaceholderText("New workspace name"), {
        target: { value: "Design Studio" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
      const call = mockFetch.mock.calls[0]!;
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body).toMatchObject({
        action: "create",
        plan: "pro",
        cycle: "monthly",
        newWorkspaceName: "Design Studio",
      });
    });

    it("shows an error message when the API returns a non-ok response", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Workspace is already on a paid plan" }),
      } as Response);

      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: /Upgrade this workspace/ }));
      fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));

      await waitFor(() =>
        expect(
          screen.getByText("Workspace is already on a paid plan")
        ).toBeInTheDocument()
      );
    });
  });

  describe("close handlers", () => {
    it("calls onClose when Cancel is clicked", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the × button is clicked", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when Escape is pressed", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the backdrop is clicked", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(screen.getByRole("dialog").parentElement!);
      expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });
  });
});
