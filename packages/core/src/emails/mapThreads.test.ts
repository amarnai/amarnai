import { describe, it, expect } from "vitest";
import { mapThreads, mapThreadDetail } from "./mapThreads.js";
import type { EmailThreadSummary, EmailThreadDetail } from "@amarnai/api-client";

function makeThread(triageStatus: EmailThreadSummary["triageStatus"]): EmailThreadSummary {
  return {
    id: "t1",
    subject: "Test",
    provider: "GMAIL",
    providerThreadId: "gmail-1",
    webLink: null,
    latestMessageAt: new Date().toISOString(),
    messageCount: 1,
    triageStatus,
    isClassifying: false,
    isQueued: false,
    createdAt: new Date().toISOString(),
    isImportant: false,
    messages: [],
    tags: [],
    latestClassification: null,
    hasDraft: false,
    isDrafting: false,
    doneMark: null,
    assignment: null,
    commentCount: 0,
    unreadCommentCount: 0,
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
    provider: "GMAIL",
    providerThreadId: "gmail-1",
    webLink: null,
    latestMessageAt: "2026-01-02T00:00:00.000Z",
    messageCount: 2,
    triageStatus: "NEEDS_REVIEW",
    isClassifying: false,
    isQueued: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    isImportant: true,
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
    filedNode: null,
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

  // A needs-review re-sort records no destination; the thread stays filed where
  // the previous run put it, and the row must keep naming that folder.
  it("keeps the filed folder when the newest classification chose none", () => {
    const detail = makeDetail();
    const t = mapThreadDetail({
      ...detail,
      latestClassification: {
        id: "c2",
        confidence: 0.4,
        needsHumanReview: true,
        finalNode: null,
      } as never,
      filedNode: { id: "n1", name: "Clients" },
    });
    expect(t.folderId).toBe("n1");
  });

  it("reverses messages to newest-first so the snippet is the latest message", () => {
    const t = mapThreadDetail(makeDetail());
    // Newest message drives the list snippet.
    expect(t.snippet).toBe("latest");
    expect(t.messages[0]!.id).toBe("m-new");
    expect(t.messages[t.messages.length - 1]!.id).toBe("m-old");
  });
});

describe("mapThreads — comment counts", () => {
  it("carries commentCount and unreadCommentCount into the view model", () => {
    const [t] = mapThreads([
      { ...makeThread("SORTED"), commentCount: 3, unreadCommentCount: 2 },
    ]);
    expect(t!.commentCount).toBe(3);
    expect(t!.unreadCommentCount).toBe(2);
  });

  // The detail endpoint has no comment meta; an injected row starts at zero
  // (no comments tag) until the next list refresh supplies real counts.
  it("defaults a detail-injected thread to zero comment counts", () => {
    const t = mapThreadDetail(makeDetail());
    expect(t.commentCount).toBe(0);
    expect(t.unreadCommentCount).toBe(0);
  });
});
