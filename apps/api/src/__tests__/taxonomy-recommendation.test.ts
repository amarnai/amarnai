import { vi, describe, it, expect, beforeEach } from "vitest";
import type { InboxProfile } from "@amarnai/shared";
import { authed, TEST_USER_ID } from "./helpers.js";

vi.mock("@amarnai/db", () => ({
  db: {
    workspaceMember: { findUnique: vi.fn() },
    emailConnection: { findUnique: vi.fn() },
    gmailSyncSettings: { findUnique: vi.fn() },
  },
  // buildInboxProfile is exercised for real in packages/db; here we stub it and
  // let the real matcher (from @amarnai/core) run against the returned profile.
  buildInboxProfile: vi.fn(),
  eligibleThreadWhere: vi.fn(),
  resolveInboxQuota: vi.fn(),
}));

import app from "../app.js";
import { db, buildInboxProfile } from "@amarnai/db";

const WS = "ws-1";

/** A profile whose subject keywords clearly point at one template. */
function profile(overrides: Partial<InboxProfile> = {}): InboxProfile {
  return {
    eligibleThreadCount: 500,
    senderDomains: Array.from({ length: 12 }, (_, i) => ({ term: `d${i}.com`, count: 20 - i })),
    senderNames: [],
    subjectKeywords: [
      { term: "escrow", count: 30 },
      { term: "mortgage", count: 25 },
      { term: "listings", count: 20 },
      { term: "appraisal", count: 15 },
    ],
    gmailLabels: [],
    senderClusters: [],
    ...overrides,
  };
}

function get() {
  return app.request(`/workspaces/${WS}/taxonomy-template-recommendation`, authed());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ userId: TEST_USER_ID } as never);
  vi.mocked(db.emailConnection.findUnique).mockResolvedValue({ workspaceId: WS } as never);
  vi.mocked(db.gmailSyncSettings.findUnique).mockResolvedValue(null as never);
  vi.mocked(buildInboxProfile).mockResolvedValue(profile());
});

describe("GET /workspaces/:workspaceId/taxonomy-template-recommendation", () => {
  it("404s for a non-member (leaks nothing)", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null as never);
    const res = await get();
    expect(res.status).toBe(404);
  });

  it("returns null when no inbox is connected (no profiling)", async () => {
    vi.mocked(db.emailConnection.findUnique).mockResolvedValue(null as never);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recommendedTemplateId: null });
    expect(buildInboxProfile).not.toHaveBeenCalled();
  });

  it("returns null below the eligible-thread floor", async () => {
    vi.mocked(buildInboxProfile).mockResolvedValue(profile({ eligibleThreadCount: 39 }));
    const res = await get();
    expect(await res.json()).toEqual({ recommendedTemplateId: null });
  });

  it("returns null below the sender-domain floor", async () => {
    vi.mocked(buildInboxProfile).mockResolvedValue(
      profile({ senderDomains: Array.from({ length: 7 }, (_, i) => ({ term: `d${i}.com`, count: 5 })) }),
    );
    const res = await get();
    expect(await res.json()).toEqual({ recommendedTemplateId: null });
  });

  it("returns the matched template id when the inbox clears the floors", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recommendedTemplateId: "real-estate-agent" });
  });
});
