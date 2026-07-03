import { describe, it, expect } from "vitest";
import { mapThreads, mapThreadDetail } from "./mapThreads.js";
import type { EmailThreadSummary, EmailThreadDetail } from "@amarnai/api-client";

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
    assignment: null,
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

function makeDetail(): EmailThreadDetail {
  return {
    id: "t1",
    subject: "Assigned to you",
    providerThreadId: "gmail-1",
    latestMessageAt: "2026-01-02T00:00:00.000Z",
    messageCount: 2,
    triageStatus: "NEEDS_REVIEW",
    isClassifying: false,
    isQueued: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    gmailIsImportant: true,
    hasDraft: true,
    isDrafting: false,
    // Detail returns messages oldest-first.
    messages: [
      {
        id: "m-old",
        senderEmail: "old@x.com",
        senderName: "Old Sender",
        subject: null,
        snippet: "first",
        bodyText: null,
        receivedAt: "2026-01-01T00:00:00.000Z",
        hasAttachments: false,
        attachments: [],
        toEmails: null,
      },
      {
        id: "m-new",
        senderEmail: "new@x.com",
        senderName: "New Sender",
        subject: null,
        snippet: "latest",
        bodyText: null,
        receivedAt: "2026-01-02T00:00:00.000Z",
        hasAttachments: true,
        attachments: [{ filename: "a.pdf", mimeType: "application/pdf" }],
        toEmails: null,
      },
    ],
    latestClassification: null,
    tags: [],
    doneMark: null,
    assignment: {
      userId: "u1",
      userName: "Alex",
      userEmail: "alex@x.com",
      assignedAt: "2026-01-02T00:00:00.000Z",
    },
  };
}

describe("mapThreadDetail", () => {
  it("projects the detail onto a ThreadItem, carrying flags and assignment", () => {
    const t = mapThreadDetail(makeDetail());
    expect(t.id).toBe("t1");
    expect(t.status).toBe("review");
    expect(t.providerThreadId).toBe("gmail-1");
    expect(t.isImportant).toBe(true);
    expect(t.hasDraft).toBe(true);
    expect(t.assignment?.userId).toBe("u1");
    expect(t.attachmentCount).toBe(1);
  });

  it("reverses messages to newest-first so the snippet is the latest message", () => {
    const t = mapThreadDetail(makeDetail());
    // Newest message drives the list snippet.
    expect(t.snippet).toBe("latest");
    expect(t.messages[0]!.id).toBe("m-new");
    expect(t.messages[t.messages.length - 1]!.id).toBe("m-old");
  });
});
