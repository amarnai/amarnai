import { describe, it, expect } from "vitest";
import type { InboxProfile } from "@amarnai/shared";
import { matchTemplateToProfile } from "./matchTemplateToProfile.js";

function profile(keywords: string[]): InboxProfile {
  return {
    eligibleThreadCount: 500,
    senderDomains: [],
    senderNames: [],
    subjectKeywords: keywords.map((term, i) => ({ term, count: 10 - i })),
    gmailLabels: [],
  };
}

describe("matchTemplateToProfile", () => {
  it("matches a freelancer inbox", () => {
    const t = matchTemplateToProfile(profile(["client", "invoice", "contract", "project"]));
    expect(t.id).toBe("freelancer");
  });

  it("matches a founder inbox", () => {
    const t = matchTemplateToProfile(profile(["investor", "customer", "hiring", "operations"]));
    expect(t.id).toBe("founder");
  });

  it("matches a student inbox", () => {
    const t = matchTemplateToProfile(profile(["course", "campus", "jobs", "social"]));
    expect(t.id).toBe("student");
  });

  it("is deterministic for the same profile", () => {
    const p = profile(["investor", "customer", "hiring"]);
    expect(matchTemplateToProfile(p).id).toBe(matchTemplateToProfile(p).id);
  });

  it("falls back to the first template with no usable signal", () => {
    const t = matchTemplateToProfile(profile([]));
    expect(t.id).toBe("freelancer");
  });

  it("always returns a valid, routable template (root + non-root folders)", () => {
    const t = matchTemplateToProfile(profile(["invoice", "client"]));
    const roots = t.file.nodes.filter((n) => n.isRoot);
    expect(roots).toHaveLength(1);
    expect(t.file.nodes.filter((n) => !n.isRoot).length).toBeGreaterThanOrEqual(3);
  });
});
