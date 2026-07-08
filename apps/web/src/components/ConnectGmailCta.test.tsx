import { render, screen, fireEvent, cleanup } from "@/test-utils";
import { describe, it, expect, afterEach, vi } from "vitest";
import { ConnectGmailCta } from "./ConnectGmailCta";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

afterEach(() => {
  cleanup();
});

const WS = "ws-1";

describe("ConnectGmailCta reconnect switch", () => {
  it("keeps same-provider reconnect primary and gates the provider switch behind a confirmation when data is retained", () => {
    render(
      <ConnectGmailCta
        workspaceId={WS}
        reconnect
        provider="GMAIL"
        secondaryProvider="OUTLOOK"
        hasSyncedData
        retainedAddress="user@gmail.com"
      />,
    );

    // Primary action reconnects the same (disconnected) provider.
    const primary = screen.getByRole("link", { name: /Reconnect Gmail/ });
    expect(primary).toHaveAttribute("href", `/api/gmail/connect?workspaceId=${WS}`);

    // Switching to the other provider is a confirm button, not a bare link.
    expect(
      screen.queryByRole("link", { name: /Connect Outlook/ }),
    ).not.toBeInTheDocument();
    const switchBtn = screen.getByRole("button", { name: /Connect Outlook/ });

    // The erasure warning only appears after the user opts in.
    expect(screen.queryByText(/permanently remove/)).not.toBeInTheDocument();
    fireEvent.click(switchBtn);

    expect(
      screen.getByText(/permanently remove the sorted email saved from user@gmail.com/),
    ).toBeInTheDocument();
    const proceed = screen.getByRole("link", { name: /Continue to Outlook/ });
    expect(proceed).toHaveAttribute("href", `/api/outlook/connect?workspaceId=${WS}`);
  });

  it("offers the provider switch as a plain link when no synced data would be erased", () => {
    render(
      <ConnectGmailCta
        workspaceId={WS}
        reconnect
        provider="GMAIL"
        secondaryProvider="OUTLOOK"
        hasSyncedData={false}
      />,
    );

    const link = screen.getByRole("link", { name: /Connect Outlook/ });
    expect(link).toHaveAttribute("href", `/api/outlook/connect?workspaceId=${WS}`);
    // No confirmation button and no warning in the no-data case.
    expect(
      screen.queryByRole("button", { name: /Connect Outlook/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/permanently remove/)).not.toBeInTheDocument();
  });

  it("shows the fresh-connect secondary link without any warning", () => {
    render(
      <ConnectGmailCta
        workspaceId={WS}
        provider="GMAIL"
        secondaryProvider="OUTLOOK"
      />,
    );

    expect(
      screen.getByRole("link", { name: /Connect Outlook/ }),
    ).toHaveAttribute("href", `/api/outlook/connect?workspaceId=${WS}`);
    expect(screen.queryByText(/permanently remove/)).not.toBeInTheDocument();
  });

  it("mirrors the labels when the disconnected inbox was Outlook", () => {
    render(
      <ConnectGmailCta
        workspaceId={WS}
        reconnect
        provider="OUTLOOK"
        secondaryProvider="GMAIL"
        hasSyncedData={false}
      />,
    );

    // Primary reconnects the Outlook inbox; secondary connects Gmail instead.
    expect(
      screen.getByRole("link", { name: /Reconnect Outlook/ }),
    ).toHaveAttribute("href", `/api/outlook/connect?workspaceId=${WS}`);
    expect(
      screen.getByRole("link", { name: /Connect Gmail/ }),
    ).toHaveAttribute("href", `/api/gmail/connect?workspaceId=${WS}`);
  });
});
