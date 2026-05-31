import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceChoiceModal } from "./WorkspaceChoiceModal";

const defaultProps = {
  workspaceName: "Acme Corp",
  onClose: vi.fn(),
  onUpgradeCurrentWorkspace: vi.fn(),
  onCreatePaidWorkspace: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
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
        screen.getByRole("button", { name: "Continue" })
      ).toBeDisabled();
    });

    it("Continue is enabled after selecting an option", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Upgrade this workspace/ })
      );
      expect(
        screen.getByRole("button", { name: "Continue" })
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
  });

  describe("handler invocation", () => {
    it("calls onUpgradeCurrentWorkspace when upgrade is selected and Continue clicked", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Upgrade this workspace/ })
      );
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(defaultProps.onUpgradeCurrentWorkspace).toHaveBeenCalledOnce();
      expect(defaultProps.onCreatePaidWorkspace).not.toHaveBeenCalled();
    });

    it("calls onCreatePaidWorkspace when create is selected and Continue clicked", () => {
      render(<WorkspaceChoiceModal {...defaultProps} />);
      fireEvent.click(
        screen.getByRole("button", { name: /Create a new workspace/ })
      );
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(defaultProps.onCreatePaidWorkspace).toHaveBeenCalledOnce();
      expect(defaultProps.onUpgradeCurrentWorkspace).not.toHaveBeenCalled();
    });

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
