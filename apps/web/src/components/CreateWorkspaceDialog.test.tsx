import { render, screen, fireEvent, cleanup, waitFor } from "@/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWorkspaceAction } from "@/actions/workspace";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock("@/actions/workspace", () => ({
  createWorkspaceAction: vi.fn(),
}));

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(window, "location", {
    value: { href: "" },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreateWorkspaceDialog", () => {
  describe("plan card visibility", () => {
    it("shows Apprentice, Scribe and Pharaoh when user has no free workspace", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      expect(screen.getByRole("button", { name: /Apprentice/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Scribe/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Pharaoh/ })).toBeInTheDocument();
    });

    it("hides Apprentice and shows only Scribe and Pharaoh when user already has a free workspace", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      expect(screen.queryByRole("button", { name: /Apprentice/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Scribe/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Pharaoh/ })).toBeInTheDocument();
    });
  });

  describe("default selection", () => {
    it("pre-selects Apprentice when user has no free workspace", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      expect(screen.getByRole("button", { name: /Apprentice/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /Create workspace/ })).toBeInTheDocument();
    });

    it("pre-selects Scribe when user already has a free workspace", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      expect(screen.getByRole("button", { name: /Scribe/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /Continue to checkout/ })).toBeInTheDocument();
    });
  });

  describe("billing cycle toggle", () => {
    it("is not shown when the Apprentice plan is selected", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      expect(screen.queryByRole("tab", { name: "Monthly" })).not.toBeInTheDocument();
    });

    it("is shown when Scribe is selected", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: /Scribe/ }));
      expect(screen.getByRole("tab", { name: "Monthly" })).toBeInTheDocument();
    });

    it("is shown when Pharaoh is selected", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: /Pharaoh/ }));
      expect(screen.getByRole("tab", { name: "Monthly" })).toBeInTheDocument();
    });

    it("switching billing cycle updates the Scribe price (annual is the default)", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: /Scribe/ }));
      // Annual is pre-selected, so the annual per-month price shows first.
      expect(screen.getByText("$5/mo")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: /Monthly/ }));
      expect(screen.getByText("$6/mo")).toBeInTheDocument();
      expect(screen.queryByText("$5/mo")).not.toBeInTheDocument();
    });
  });

  describe("validation", () => {
    it("shows an error and does not call createWorkspaceAction when name is empty", async () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));
      expect(screen.getByText("Workspace name cannot be empty")).toBeInTheDocument();
      expect(vi.mocked(createWorkspaceAction)).not.toHaveBeenCalled();
    });

    it("shows an error and does not call fetch when name is whitespace-only on a paid plan", async () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "   " },
      });
      fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/ }));
      expect(screen.getByText("Workspace name cannot be empty")).toBeInTheDocument();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  describe("free workspace creation", () => {
    it("calls createWorkspaceAction with the trimmed name", async () => {
      vi.mocked(createWorkspaceAction).mockResolvedValue({ success: true });
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "  My New Workspace  " },
      });
      fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));
      await waitFor(() =>
        expect(vi.mocked(createWorkspaceAction)).toHaveBeenCalledWith("My New Workspace")
      );
    });

    it("calls onClose and router.push on success", async () => {
      vi.mocked(createWorkspaceAction).mockResolvedValue({ success: true });
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "My New Workspace" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(mockPush).toHaveBeenCalledWith("/emails");
    });

    it("shows the error and does not call onClose when the action returns an error", async () => {
      vi.mocked(createWorkspaceAction).mockResolvedValue({
        error: "You already have a free workspace.",
      });
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "Duplicate" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Create workspace/ }));
      await waitFor(() =>
        expect(screen.getByText("You already have a free workspace.")).toBeInTheDocument()
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("paid workspace creation", () => {
    it("calls the checkout API with the correct payload", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/pay/cs_test" }),
      } as Response);
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "Acme Corp" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/ }));
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
      const call = vi.mocked(fetch).mock.calls[0]!;
      expect(call[0]).toBe("/api/billing/create-checkout-session");
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body).toMatchObject({
        action: "create",
        plan: "pro",
        cycle: "annual",
        newWorkspaceName: "Acme Corp",
      });
    });

    it("sends cycle: annual when annual is selected", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/pay/cs_test" }),
      } as Response);
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      fireEvent.click(screen.getByRole("tab", { name: /Annual/ }));
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "Acme Corp" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/ }));
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
      const body = JSON.parse(
        (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string
      );
      expect(body.cycle).toBe("annual");
    });

    it("redirects to the Stripe URL on success", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/pay/cs_test" }),
      } as Response);
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "Acme Corp" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/ }));
      await waitFor(() =>
        expect(window.location.href).toBe("https://checkout.stripe.com/pay/cs_test")
      );
    });

    it("shows an error and does not redirect when the API returns a non-ok response", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Plan not available" }),
      } as Response);
      render(<CreateWorkspaceDialog hasFreeWorkspace={true} onClose={onClose} />);
      fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
        target: { value: "Acme Corp" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Continue to checkout/ }));
      await waitFor(() =>
        expect(screen.getByText("Plan not available")).toBeInTheDocument()
      );
      expect(window.location.href).toBe("");
    });
  });

  describe("close handlers", () => {
    it("calls onClose when the × button is clicked", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when Cancel is clicked", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when Escape is pressed", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("calls onClose when the backdrop is clicked", () => {
      render(<CreateWorkspaceDialog hasFreeWorkspace={false} onClose={onClose} />);
      fireEvent.click(screen.getByRole("dialog").parentElement!);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
