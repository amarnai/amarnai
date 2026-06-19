import { describe, it, expect } from "vitest";
import { workspaceInitials, workspaceHue, userInitials } from "./marks.js";

describe("workspaceInitials", () => {
  it("takes first + last word initials for multi-word names", () => {
    expect(workspaceInitials("Acme Corp")).toBe("AC");
    expect(workspaceInitials("Red Green Blue")).toBe("RB");
  });

  it("takes the first two letters of a single word", () => {
    expect(workspaceInitials("Personal")).toBe("PE");
  });

  it("falls back to ? for an empty name", () => {
    expect(workspaceInitials("")).toBe("?");
    expect(workspaceInitials("   ")).toBe("?");
  });
});

describe("workspaceHue", () => {
  it("is deterministic and in range [0, 360)", () => {
    const hue = workspaceHue("Acme Corp");
    expect(hue).toBe(workspaceHue("Acme Corp"));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("differs for different names", () => {
    expect(workspaceHue("Acme Corp")).not.toBe(workspaceHue("Globex"));
  });
});

describe("userInitials", () => {
  it("prefers the display name when present", () => {
    expect(userInitials("Jane Doe", "jane@example.com")).toBe("JD");
    expect(userInitials("Madonna", "m@example.com")).toBe("MA");
  });

  it("falls back to the first two email letters without a name", () => {
    expect(userInitials(null, "benjamin@example.com")).toBe("BE");
  });
});
