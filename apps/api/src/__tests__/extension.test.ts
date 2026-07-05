import { vi, describe, it, expect, beforeEach } from "vitest";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    extensionInstall: { upsert: vi.fn() },
  },
  deleteExtensionNudgeNotifications: vi.fn(),
}));

import app from "../app.js";
import { db, deleteExtensionNudgeNotifications } from "@amarnai/db";
import { issueAccessToken } from "@amarnai/auth";

const VALID_BODY = { browser: "CHROME", version: "0.1.0" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.extensionInstall.upsert).mockResolvedValue({ id: "ext-1" } as never);
  vi.mocked(deleteExtensionNudgeNotifications).mockResolvedValue(undefined as never);
});

function postRegister(init: RequestInit, body: unknown = VALID_BODY) {
  return app.request(
    "/extension/register",
    authed({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    }),
  );
}

describe("POST /extension/register — auth", () => {
  it("rejects an unauthenticated request (no token)", async () => {
    const res = await app.request("/extension/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(401);
    expect(db.extensionInstall.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /extension/register — registration", () => {
  it("upserts the install for the authenticated user and clears any outstanding nudge", async () => {
    const res = await postRegister({});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(db.extensionInstall.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TEST_USER_ID },
        create: expect.objectContaining({ userId: TEST_USER_ID, browser: "CHROME", version: "0.1.0" }),
        update: expect.objectContaining({ browser: "CHROME", version: "0.1.0" }),
      }),
    );
    expect(deleteExtensionNudgeNotifications).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it("binds the install to the JWT subject, ignoring a caller-supplied X-User-Id", async () => {
    const token = await issueAccessToken("jwt-user-9");
    const res = await app.request("/extension/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Id": "attacker-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    expect(db.extensionInstall.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: "jwt-user-9" }) }),
    );
  });

  it("rejects an invalid browser", async () => {
    const res = await postRegister({}, { browser: "SAFARI", version: "0.1.0" });
    expect(res.status).toBe(400);
    expect(db.extensionInstall.upsert).not.toHaveBeenCalled();
  });

  it("rejects a body with a missing version", async () => {
    const res = await postRegister({}, { browser: "CHROME" });
    expect(res.status).toBe(400);
    expect(db.extensionInstall.upsert).not.toHaveBeenCalled();
  });
});
