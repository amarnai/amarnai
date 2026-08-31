import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

// The Microsoft button must never render in a build that has no Microsoft client
// id: the OAuth flow would fail on launch with "VITE_MS_CLIENT_ID is not
// configured", which reads to the user as Aziru being broken. MS_CLIENT_ID is
// a module-level const, so the config mock is chosen per test file via vi.mock
// (hoisted); this file covers the configured case and asserts the gate exists.
vi.mock("../config", () => ({
  MS_CLIENT_ID: "ms-client-id",
  API_BASE_URL: "http://localhost:3001",
  WEB_APP_URL: "http://localhost:3000",
}));

const signInWithGoogle = vi.fn();
const signInWithMicrosoft = vi.fn();
const signIn = vi.fn();

vi.mock("./session", () => ({
  useSession: () => ({ signIn, signInWithGoogle, signInWithMicrosoft }),
}));

vi.mock("../platform/permissions", () => ({
  ensureHostPermissions: vi.fn(async () => true),
}));

import { SignInScreen } from "./SignInScreen";
import { MicrosoftAuthCancelledError } from "./microsoftAuth";

i18n.load("en", {});
i18n.activate("en");

// Vitest runs without globals here, so testing-library's automatic afterEach
// cleanup never registers; without this, renders accumulate across tests.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderScreen() {
  render(
    <I18nProvider i18n={i18n}>
      <SignInScreen />
    </I18nProvider>,
  );
}

describe("SignInScreen", () => {
  it("offers both providers when a Microsoft client id is configured", () => {
    renderScreen();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with Microsoft/i })).toBeTruthy();
  });

  it("runs the Microsoft sign-in flow when its button is clicked", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Microsoft/i }));

    await waitFor(() => expect(signInWithMicrosoft).toHaveBeenCalledTimes(1));
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it("disables every control while one flow is in flight", async () => {
    let release: () => void = () => {};
    signInWithMicrosoft.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    renderScreen();
    const google = screen.getByRole("button", { name: /Continue with Google/i });
    fireEvent.click(screen.getByRole("button", { name: /Continue with Microsoft/i }));

    await waitFor(() => expect((google as HTMLButtonElement).disabled).toBe(true));
    release();
    await waitFor(() => expect((google as HTMLButtonElement).disabled).toBe(false));
  });

  it("stays silent when the user dismisses the Microsoft consent window", async () => {
    signInWithMicrosoft.mockRejectedValue(new MicrosoftAuthCancelledError());

    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Microsoft/i }));

    await waitFor(() => expect(signInWithMicrosoft).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the failure message for a real Microsoft sign-in error", async () => {
    signInWithMicrosoft.mockRejectedValue(new Error("Outlook read access was not granted"));

    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Microsoft/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Outlook read access was not granted");
  });
});
