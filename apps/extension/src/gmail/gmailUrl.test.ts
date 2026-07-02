import { describe, it, expect } from "vitest";
import { buildGmailThreadUrl } from "./gmailUrl";

describe("buildGmailThreadUrl", () => {
  it("routes by authuser=<email> and uses the #all/ view", () => {
    const url = buildGmailThreadUrl("user@example.com", "18c2f4a9b3d5e6f7");
    expect(url).toBe(
      "https://mail.google.com/mail/?authuser=user%40example.com#all/18c2f4a9b3d5e6f7",
    );
  });

  it("encodes the account email but leaves the raw hex thread id in the hash", () => {
    const url = buildGmailThreadUrl("a+b@example.com", "deadbeef");
    expect(url).toContain("authuser=a%2Bb%40example.com");
    expect(url).toContain("#all/deadbeef");
  });

  it("never uses the positional /u/<index> form", () => {
    const url = buildGmailThreadUrl("user@example.com", "abc123");
    expect(url).not.toMatch(/\/u\/\d+/);
  });
});
