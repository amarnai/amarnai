import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildGmailAuthUrl, generateState, verifyState } from "./gmail-oauth";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("AUTH_GOOGLE_ID", "client-123");
  vi.stubEnv("GMAIL_OAUTH_CALLBACK_URL", "https://app.test/api/gmail/callback");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildGmailAuthUrl", () => {
  it("requests only gmail.readonly when the writeback feature is off", () => {
    vi.stubEnv("LABEL_WRITEBACK_ENABLED", "false");
    const url = new URL(buildGmailAuthUrl("state-x"));
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("requests gmail.modify UPFRONT on a normal connect when the feature is on", () => {
    vi.stubEnv("LABEL_WRITEBACK_ENABLED", "true");
    const url = new URL(buildGmailAuthUrl("state-x"));
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("adds gmail.modify for the explicit writeback upgrade even with the flag off", () => {
    vi.stubEnv("LABEL_WRITEBACK_ENABLED", "false");
    const url = new URL(buildGmailAuthUrl("state-x", { writeback: true }));
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
});

describe("OAuth state intent round-trip", () => {
  it("defaults to the connect intent", () => {
    const state = generateState("ws-1", "user-1");
    expect(verifyState(state, "user-1", "ws-1").intent).toBe("connect");
  });

  it("preserves the writeback intent through sign/verify", () => {
    const state = generateState("ws-1", "user-1", "writeback");
    expect(verifyState(state, "user-1", "ws-1").intent).toBe("writeback");
  });

  it("rejects a state whose user does not match", () => {
    const state = generateState("ws-1", "user-1", "writeback");
    expect(() => verifyState(state, "user-2", "ws-1")).toThrow();
  });
});
