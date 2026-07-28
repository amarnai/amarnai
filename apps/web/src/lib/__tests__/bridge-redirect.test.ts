import { describe, it, expect } from "vitest";
import { sanitizeBridgePath, BRIDGE_DEFAULT_PATH } from "@/lib/bridge-redirect";

describe("sanitizeBridgePath", () => {
  it("keeps an allowed path", () => {
    expect(sanitizeBridgePath("/folders")).toBe("/folders");
    expect(sanitizeBridgePath("/settings")).toBe("/settings");
  });

  it("keeps an allowed path with a query string", () => {
    expect(sanitizeBridgePath("/upgrade?ctx=collaborators")).toBe("/upgrade?ctx=collaborators");
  });

  it("keeps an allowed path with a fragment", () => {
    expect(sanitizeBridgePath("/settings#team-members")).toBe("/settings#team-members");
  });

  it("keeps a nested path under an allowed prefix", () => {
    expect(sanitizeBridgePath("/upgrade/resume?session_id=cs_1")).toBe(
      "/upgrade/resume?session_id=cs_1"
    );
  });

  it("falls back for a path outside the allowlist", () => {
    expect(sanitizeBridgePath("/admin")).toBe(BRIDGE_DEFAULT_PATH);
    expect(sanitizeBridgePath("/api/internal/workspaces")).toBe(BRIDGE_DEFAULT_PATH);
  });

  it("rejects a prefix that only looks allowed", () => {
    expect(sanitizeBridgePath("/settings-export")).toBe(BRIDGE_DEFAULT_PATH);
    expect(sanitizeBridgePath("/foldersomething")).toBe(BRIDGE_DEFAULT_PATH);
  });

  it("rejects absolute URLs to other origins", () => {
    expect(sanitizeBridgePath("https://evil.example/steal")).toBe(BRIDGE_DEFAULT_PATH);
    expect(sanitizeBridgePath("http://evil.example/emails")).toBe(BRIDGE_DEFAULT_PATH);
  });

  it("rejects protocol-relative and backslash open-redirect tricks", () => {
    expect(sanitizeBridgePath("//evil.example/emails")).toBe(BRIDGE_DEFAULT_PATH);
    expect(sanitizeBridgePath("/\\evil.example/emails")).toBe(BRIDGE_DEFAULT_PATH);
  });

  it("falls back for empty and missing values", () => {
    expect(sanitizeBridgePath(null)).toBe(BRIDGE_DEFAULT_PATH);
    expect(sanitizeBridgePath(undefined)).toBe(BRIDGE_DEFAULT_PATH);
    expect(sanitizeBridgePath("")).toBe(BRIDGE_DEFAULT_PATH);
  });
});
