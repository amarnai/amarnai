import { describe, expect, it } from "vitest";
import { setupI18n } from "@lingui/core";
import { getCollaboratorLimit } from "@amarnai/shared";
import { DEMO_WORKSPACE_PLAN, getDemoMembers, getDemoThreads } from "./demo-seed.js";

// No catalog: every getDemo* builder resolves its descriptors through i18n._,
// which falls back to the source string when nothing is loaded. That is exactly
// what these assertions want — the English seed.
const i18n = setupI18n({ locale: "en", messages: { en: {} } });

describe("demo workspace headcount", () => {
  // The demo claims a plan in its syncInfo and shows a member list in the
  // assignment UI. A demo workspace with more people than its own plan sells is
  // the kind of detail that discredits the whole figure for anyone who also
  // reads the pricing page, and nothing else would catch it.
  it("fits inside the claimed plan's collaborator limit", () => {
    const members = getDemoMembers(i18n);
    const seats = getCollaboratorLimit(DEMO_WORKSPACE_PLAN) + 1; // + the owner
    expect(members.length).toBeGreaterThan(1); // or assignment is never offered
    expect(members.length).toBeLessThanOrEqual(seats);
  });

  it("assigns every assigned thread to a member of that workspace", () => {
    const memberIds = new Set(getDemoMembers(i18n).map((m) => m.userId));
    for (const thread of getDemoThreads(i18n)) {
      if (thread.assignment) expect(memberIds).toContain(thread.assignment.userId);
    }
  });
});
