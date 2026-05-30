import { describe, it, expect } from "vitest";
import { latestExternalMessageTime } from "../jobs/sync-inbox.js";

const WORKSPACE_EMAIL = "workspace@example.com";

const t = (iso: string) => new Date(iso);

describe("latestExternalMessageTime", () => {
  it("returns null when there are no messages", () => {
    expect(latestExternalMessageTime([], WORKSPACE_EMAIL)).toBeNull();
  });

  it("returns null when all messages are from the workspace email", () => {
    const messages = [
      { senderEmail: WORKSPACE_EMAIL, receivedAt: t("2026-05-01T10:00:00Z") },
      { senderEmail: WORKSPACE_EMAIL.toUpperCase(), receivedAt: t("2026-05-02T10:00:00Z") },
    ];
    expect(latestExternalMessageTime(messages, WORKSPACE_EMAIL)).toBeNull();
  });

  it("returns the receivedAt of the single external message", () => {
    const extDate = t("2026-05-03T12:00:00Z");
    const messages = [
      { senderEmail: "external@other.com", receivedAt: extDate },
    ];
    expect(latestExternalMessageTime(messages, WORKSPACE_EMAIL)).toEqual(extDate);
  });

  it("returns the latest receivedAt among multiple external messages", () => {
    const earlier = t("2026-05-01T10:00:00Z");
    const later   = t("2026-05-05T15:00:00Z");
    const messages = [
      { senderEmail: "a@other.com", receivedAt: earlier },
      { senderEmail: WORKSPACE_EMAIL, receivedAt: t("2026-05-10T10:00:00Z") },
      { senderEmail: "b@other.com", receivedAt: later },
    ];
    expect(latestExternalMessageTime(messages, WORKSPACE_EMAIL)).toEqual(later);
  });

  it("is case-insensitive when comparing workspace email", () => {
    const messages = [
      { senderEmail: WORKSPACE_EMAIL.toUpperCase(), receivedAt: t("2026-05-01T10:00:00Z") },
    ];
    expect(latestExternalMessageTime(messages, WORKSPACE_EMAIL)).toBeNull();
  });

  it("treats a mixed-case external sender as external", () => {
    const extDate = t("2026-05-04T09:00:00Z");
    const messages = [
      { senderEmail: "External@Other.COM", receivedAt: extDate },
    ];
    expect(latestExternalMessageTime(messages, WORKSPACE_EMAIL)).toEqual(extDate);
  });
});
