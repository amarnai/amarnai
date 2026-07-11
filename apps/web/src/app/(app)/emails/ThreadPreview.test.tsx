import { render, screen, cleanup, waitFor } from "@/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "@amarnai/ui/emails";
import type { EmailThreadDetail } from "@amarnai/api-client";
import { ThreadPreview } from "./ThreadPreview";

vi.mock("@/lib/api", () => ({
  api: {
    emailThread: vi.fn(),
    threadBodies: vi.fn(),
    threadDrafts: vi.fn(),
    draftQuota: vi.fn(),
    generateDraft: vi.fn(),
    toggleDraftSent: vi.fn(),
  },
}));

import { api } from "@/lib/api";

const WS = "ws-1";

// A thread with one message from Alice, sorted into "folder-1".
function threadV1(): ThreadItem {
  return {
    id: "t-1",
    subject: "Project kickoff",
    provider: "GMAIL",
    providerThreadId: "gmail-1",
    webLink: null,
    participants: "Alice Smith",
    latestAt: new Date("2026-07-11T10:00:00Z"),
    messageCount: 1,
    snippet: "Let's get started",
    unread: false,
    folderId: "folder-1",
    status: "sorted",
    confidence: 0.9,
    reasoning: null,
    alternativeFolder: null,
    messages: [
      {
        id: "m-1",
        fromName: "Alice Smith",
        fromEmail: "alice@example.com",
        time: new Date("2026-07-11T10:00:00Z"),
        snippet: "Let's get started",
        bodyText: null,
      },
    ],
    hasDraft: false,
    isDrafting: false,
    lastSenderEmail: "alice@example.com",
    doneMark: null,
    assignment: null,
    isImportant: false,
    isClassifying: false,
    attachmentCount: 0,
  };
}

// The same thread after a new message from Bob arrives via the live refresh:
// same id, higher messageCount, newer latestAt. This is the object the parent
// hands the preview through selectedThread on an SSE refresh.
function threadV2(): ThreadItem {
  const t = threadV1();
  return {
    ...t,
    participants: "Alice Smith, Bob Jones",
    latestAt: new Date("2026-07-11T11:00:00Z"),
    messageCount: 2,
    lastSenderEmail: "bob@example.com",
    messages: [
      ...t.messages,
      {
        id: "m-2",
        fromName: "Bob Jones",
        fromEmail: "bob@example.com",
        time: new Date("2026-07-11T11:00:00Z"),
        snippet: "One more thing",
        bodyText: null,
      },
    ],
  };
}

// Minimal detail response for the emailThread refetch. `explanation` is the
// rationale text the preview shows; vary it per version to prove the rationale
// re-fetches too, not just the message list.
function detail(messageIds: string[], explanation: string): EmailThreadDetail {
  return {
    id: "t-1",
    subject: "Project kickoff",
    provider: "GMAIL",
    providerThreadId: "gmail-1",
    webLink: null,
    latestMessageAt: "2026-07-11T11:00:00Z",
    messageCount: messageIds.length,
    triageStatus: "SORTED",
    isClassifying: false,
    isQueued: false,
    createdAt: "2026-07-11T10:00:00Z",
    updatedAt: "2026-07-11T11:00:00Z",
    isImportant: false,
    hasDraft: false,
    isDrafting: false,
    messages: messageIds.map((id, idx) => ({
      id,
      senderEmail: idx === 0 ? "alice@example.com" : "bob@example.com",
      senderName: idx === 0 ? "Alice Smith" : "Bob Jones",
      subject: "Project kickoff",
      snippet: idx === 0 ? "Let's get started" : "One more thing",
      bodyText: idx === 0 ? "First body" : "Second body",
      receivedAt: idx === 0 ? "2026-07-11T10:00:00Z" : "2026-07-11T11:00:00Z",
      hasAttachments: false,
      attachments: [],
      toEmails: [],
    })),
    latestClassification: {
      id: "c-1",
      confidence: 0.9,
      explanation,
      priority: null,
      urgency: null,
      riskLevel: null,
      requiredAction: null,
      sensitivity: null,
      dueAt: null,
      suggestedNextStep: null,
      needsHumanReview: false,
      decisionSource: null,
      modelProvider: null,
      modelName: null,
      createdAt: "2026-07-11T10:00:00Z",
      finalNode: { id: "folder-1", name: "Work" },
    },
    tags: [],
    doneMark: null,
    assignment: null,
  };
}

const noop = () => {};

function renderPreview(thread: ThreadItem) {
  return render(
    <ThreadPreview
      thread={thread}
      folders={[{ id: "folder-1", name: "Work", description: null, parentId: null, ignored: false }]}
      workspaceId={WS}
      workspaceEmail={null}
      routableNodeCount={3}
      onApprove={noop}
      onReroute={noop}
      onClose={noop}
      onDraftStarted={noop}
      onDraftFailed={noop}
      onDraftGenerated={noop}
      onDraftSentToggled={noop}
      onMarkDone={noop}
      onUnmarkDone={noop}
      onToggleImportant={noop}
      members={[]}
      canAssign={false}
      onOpenAssign={noop}
    />,
  );
}

beforeEach(() => {
  vi.mocked(api.threadBodies).mockResolvedValue({ bodies: {} });
  vi.mocked(api.threadDrafts).mockResolvedValue({ drafts: [] });
  vi.mocked(api.draftQuota).mockResolvedValue({ used: 0, limit: 5, resetsAt: "2026-08-01T00:00:00Z" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadPreview live update when an open thread gains a message", () => {
  it("reloads the message list and rationale when the same thread's content changes", async () => {
    vi.mocked(api.emailThread)
      .mockResolvedValueOnce(detail(["m-1"], "Filed under Work: kickoff planning."))
      .mockResolvedValueOnce(detail(["m-1", "m-2"], "Re-sorted: Bob's reply added context."));

    const { rerender } = renderPreview(threadV1());

    // Initial state: one message, its rationale from the first detail fetch.
    expect(await screen.findByText("Alice Smith")).toBeInTheDocument();
    expect(await screen.findByText("Filed under Work: kickoff planning.")).toBeInTheDocument();
    expect(screen.queryByText("Bob Jones")).not.toBeInTheDocument();
    expect(api.emailThread).toHaveBeenCalledTimes(1);

    // The parent hands over a fresh thread object: same id, new message.
    rerender(
      <ThreadPreview
        thread={threadV2()}
        folders={[{ id: "folder-1", name: "Work", description: null, parentId: null, ignored: false }]}
        workspaceId={WS}
        workspaceEmail={null}
        routableNodeCount={3}
        onApprove={noop}
        onReroute={noop}
        onClose={noop}
        onDraftStarted={noop}
        onDraftFailed={noop}
        onDraftGenerated={noop}
        onDraftSentToggled={noop}
        onMarkDone={noop}
        onUnmarkDone={noop}
        onToggleImportant={noop}
        members={[]}
        canAssign={false}
        onOpenAssign={noop}
      />,
    );

    // The new message and the refreshed rationale appear without a remount.
    expect(await screen.findByText("Bob Jones")).toBeInTheDocument();
    expect(await screen.findByText("Re-sorted: Bob's reply added context.")).toBeInTheDocument();
    await waitFor(() => expect(api.emailThread).toHaveBeenCalledTimes(2));
  });

  it("does not refetch when an unrelated prop changes but the content signal is unchanged", async () => {
    vi.mocked(api.emailThread).mockResolvedValue(detail(["m-1"], "Filed under Work."));

    const { rerender } = renderPreview(threadV1());

    expect(await screen.findByText("Alice Smith")).toBeInTheDocument();
    await waitFor(() => expect(api.emailThread).toHaveBeenCalledTimes(1));

    // A re-render with a brand-new object whose id/messageCount/latestAt/folderId
    // are unchanged (only isImportant flipped) must NOT trigger a detail refetch —
    // this is what keying on the object identity would wrongly do, and what the
    // id-only key protected against.
    rerender(
      <ThreadPreview
        thread={{ ...threadV1(), isImportant: true }}
        folders={[{ id: "folder-1", name: "Work", description: null, parentId: null, ignored: false }]}
        workspaceId={WS}
        workspaceEmail={null}
        routableNodeCount={3}
        onApprove={noop}
        onReroute={noop}
        onClose={noop}
        onDraftStarted={noop}
        onDraftFailed={noop}
        onDraftGenerated={noop}
        onDraftSentToggled={noop}
        onMarkDone={noop}
        onUnmarkDone={noop}
        onToggleImportant={noop}
        members={[]}
        canAssign={false}
        onOpenAssign={noop}
      />,
    );

    // Give any errant effect a chance to fire, then assert it did not.
    await Promise.resolve();
    expect(api.emailThread).toHaveBeenCalledTimes(1);
  });
});
