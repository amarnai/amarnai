import { vi, describe, it, expect, beforeEach } from "vitest";

// Unit tests for registerOutlookSubscription's environment guards. The service
// reads config.outlook.notificationUrl, which @amarnai/config derives from
// MS_GRAPH_NOTIFICATION_URL at import time, so each case resets modules and
// re-imports the service with the desired env.

const findUnique = vi.fn();
const update = vi.fn();
const registerWatch = vi.fn();
const stopWatch = vi.fn();

vi.mock("@amarnai/db", () => ({
  db: {
    emailConnection: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

const createMailProvider = vi.fn((..._args: unknown[]) => ({ registerWatch, stopWatch }));
vi.mock("@amarnai/mail", () => ({
  createMailProvider: (...args: unknown[]) => createMailProvider(...args),
}));

async function loadService(notificationUrl: string | undefined) {
  vi.resetModules();
  if (notificationUrl === undefined) {
    delete process.env["MS_GRAPH_NOTIFICATION_URL"];
    delete process.env["MS_GRAPH_SUBSCRIPTION_SECRET"];
  } else {
    process.env["MS_GRAPH_NOTIFICATION_URL"] = notificationUrl;
    // Config rejects a notification URL without a subscription secret.
    process.env["MS_GRAPH_SUBSCRIPTION_SECRET"] = "sub-secret";
  }
  return import("../services/outlook-subscription.js");
}

const ACTIVE_OUTLOOK = {
  provider: "OUTLOOK",
  encryptedRefreshToken: "enc",
  status: "ACTIVE",
  emailAddress: "user@outlook.com",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerOutlookSubscription", () => {
  it("no-ops without touching Graph when the notification URL is unset", async () => {
    const { registerOutlookSubscription } = await loadService(undefined);
    const result = await registerOutlookSubscription("ws-1");

    expect(result).toEqual({ ok: false, reason: "no_notification_url" });
    expect(findUnique).not.toHaveBeenCalled();
    expect(createMailProvider).not.toHaveBeenCalled();
  });

  it("no-ops without touching Graph when the notification URL is not HTTPS (local dev)", async () => {
    const { registerOutlookSubscription } = await loadService("http://localhost:3001/graph");
    const result = await registerOutlookSubscription("ws-1");

    expect(result).toEqual({ ok: false, reason: "notification_url_not_https" });
    // The whole point: never call Graph with a URL it deterministically rejects.
    expect(findUnique).not.toHaveBeenCalled();
    expect(createMailProvider).not.toHaveBeenCalled();
    expect(registerWatch).not.toHaveBeenCalled();
  });

  it("registers the subscription when the notification URL is HTTPS", async () => {
    findUnique.mockResolvedValue(ACTIVE_OUTLOOK);
    const expiresMs = 1_800_000_000_000;
    registerWatch.mockResolvedValue({ expiresAt: expiresMs, cursor: "c1" });
    stopWatch.mockResolvedValue(undefined);
    update.mockResolvedValue(undefined);

    const { registerOutlookSubscription } = await loadService("https://push.example.com/graph");
    const result = await registerOutlookSubscription("ws-1");

    expect(registerWatch).toHaveBeenCalledWith("https://push.example.com/graph");
    expect(update).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { watchExpiresAt: new Date(expiresMs) },
    });
    expect(result).toEqual({ ok: true, expiresAt: new Date(expiresMs) });
  });
});
