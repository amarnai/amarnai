import { describe, it, expect } from "vitest";
import { mapThreads } from "./mapThreads.js";
import type { EmailThreadSummary } from "@amarnai/api-client";

function makeThread(triageStatus: EmailThreadSummary["triageStatus"]): EmailThreadSummary {
  return {
    id: "t1",
    subject: "Test",
    providerThreadId: "gmail-1",
    latestMessageAt: new Date().toISOString(),
    messageCount: 1,
    triageStatus,
    isClassifying: false,
    isQueued: false,
    createdAt: new Date().toISOString(),
    gmailIsImportant: false,
    messages: [],
    tags: [],
    latestClassification: null,
    hasDraft: false,
    isDrafting: false,
    doneMark: null,
  };
}

describe("mapThreads — triageStatus → ThreadItem.status", () => {
  it("maps SORTED → 'sorted'", () => {
    const [t] = mapThreads([makeThread("SORTED")]);
    expect(t!.status).toBe("sorted");
  });

  it("maps NEEDS_REVIEW → 'review'", () => {
    const [t] = mapThreads([makeThread("NEEDS_REVIEW")]);
    expect(t!.status).toBe("review");
  });

  it("maps PENDING → 'unsorted'", () => {
    const [t] = mapThreads([makeThread("PENDING")]);
    expect(t!.status).toBe("unsorted");
  });

  it("maps UNROUTED → 'unrouted'", () => {
    const [t] = mapThreads([makeThread("UNROUTED")]);
    expect(t!.status).toBe("unrouted");
  });

  it("maps UNCLASSIFIED → 'unclassified'", () => {
    const [t] = mapThreads([makeThread("UNCLASSIFIED")]);
    expect(t!.status).toBe("unclassified");
  });
});
