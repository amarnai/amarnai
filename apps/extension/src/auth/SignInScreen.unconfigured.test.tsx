import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

// MS_CLIENT_ID is a module-level const, so the "not configured" case needs its
// own file with the config mock hoisted to an empty id. See SignInScreen.test.tsx
// for the configured half.
vi.mock("../config", () => ({
  MS_CLIENT_ID: "",
  API_BASE_URL: "http://localhost:3001",
  WEB_APP_URL: "http://localhost:3000",
}));

vi.mock("./session", () => ({
  useSession: () => ({
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithMicrosoft: vi.fn(),
  }),
}));

vi.mock("../platform/permissions", () => ({
  ensureHostPermissions: vi.fn(async () => true),
}));

import { SignInScreen } from "./SignInScreen";

i18n.load("en", {});
i18n.activate("en");

afterEach(cleanup);

describe("SignInScreen without a Microsoft client id", () => {
  it("hides the Microsoft button but keeps Google", () => {
    render(
      <I18nProvider i18n={i18n}>
        <SignInScreen />
      </I18nProvider>,
    );

    expect(screen.queryByRole("button", { name: /Continue with Microsoft/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeTruthy();
  });
});
