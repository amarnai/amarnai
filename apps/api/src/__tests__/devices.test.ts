import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    pushDevice: { upsert: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import app from "../app.js";
import { db } from "@amarnai/db";
import { issueAccessToken } from "@amarnai/auth";

const VALID_BODY = { expoPushToken: "ExponentPushToken[abc123]", platform: "ANDROID" };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: token not seen before (fresh registration).
  vi.mocked(db.pushDevice.findUnique).mockResolvedValue(null);
  vi.mocked(db.user.findUnique).mockResolvedValue({ sessionEpoch: 0 } as never);
  vi.mocked(db.pushDevice.upsert).mockResolvedValue({
    id: "device-1",
    platform: "ANDROID",
    createdAt: new Date(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

function postDevice(init: RequestInit, body: unknown = VALID_BODY) {
  return app.request(
    "/devices",
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    }),
  );
}

describe("POST /devices — auth", () => {
  it("rejects an unauthenticated request (no token)", async () => {
    const res = await app.request("/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
    expect(db.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token", async () => {
    const res = await app.request("/devices", {
      method: "POST",
      headers: { Authorization: "Bearer nope", "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
    expect(db.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 when the internal secret is presented without an X-User-Id", async () => {
    // No resolved userId → the route cannot bind the device to anyone.
    const res = await app.request(
      "/devices",
      authed(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(VALID_BODY),
        },
        null,
      ),
    );
    expect(res.status).toBe(401);
    expect(db.pushDevice.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /devices — registration", () => {
  it("upserts the device for the authenticated user (internal-secret + X-User-Id path)", async () => {
    const res = await postDevice({});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, deviceId: "device-1" });
    expect(db.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expoPushToken: VALID_BODY.expoPushToken },
        create: expect.objectContaining({
          userId: TEST_USER_ID,
          expoPushToken: VALID_BODY.expoPushToken,
          platform: "ANDROID",
        }),
        update: expect.objectContaining({ userId: TEST_USER_ID, platform: "ANDROID" }),
      }),
    );
  });

  it("binds the device to the JWT subject, ignoring a caller-supplied X-User-Id", async () => {
    const token = await issueAccessToken("jwt-user-9", 0);
    const res = await app.request("/devices", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Id": "attacker-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    expect(db.pushDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: "jwt-user-9" }),
      }),
    );
  });

  it("rejects a body with a missing token", async () => {
    const res = await postDevice({}, { platform: "ANDROID" });
    expect(res.status).toBe(400);
    expect(db.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid platform", async () => {
    const res = await postDevice({}, { expoPushToken: "x", platform: "WINDOWS" });
    expect(res.status).toBe(400);
    expect(db.pushDevice.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /devices — reassignment audit trail", () => {
  it("logs a security warning when a token moves to a different user", async () => {
    vi.mocked(db.pushDevice.findUnique).mockResolvedValue({
      userId: "previous-owner",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await postDevice({}); // authenticated as TEST_USER_ID
    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0]!.join(" ");
    expect(logged).toContain("previous-owner");
    expect(logged).toContain(TEST_USER_ID);
    // Never log the token value itself.
    expect(logged).not.toContain(VALID_BODY.expoPushToken);

    warn.mockRestore();
  });

  it("does not warn when the same user re-registers their own token", async () => {
    vi.mocked(db.pushDevice.findUnique).mockResolvedValue({
      userId: TEST_USER_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await postDevice({});
    expect(res.status).toBe(201);
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it("does not warn on a brand-new token", async () => {
    vi.mocked(db.pushDevice.findUnique).mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await postDevice({});
    expect(res.status).toBe(201);
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});
