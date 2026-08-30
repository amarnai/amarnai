import type {
  EmailThreadSummary,
  EmailThreadDetail,
  TaxonomyNode,
  TaxonomyEdge,
} from "@aziru/api-client";
import type { FolderItem, ThreadItem } from "./types.js";

export function mapFolders(
  nodes: TaxonomyNode[],
  edges: TaxonomyEdge[]
): FolderItem[] {
  const root = nodes.find((n) => n.isRoot);
  if (!root) return [];

  const parentMap = new Map<string, string>();
  for (const edge of edges) parentMap.set(edge.targetNodeId, edge.sourceNodeId);

  return nodes
    .filter((n) => !n.isRoot)
    .map((n) => {
      const parentNodeId = parentMap.get(n.id);
      return {
        id: n.id,
        name: n.name,
        description: n.description,
        parentId: parentNodeId === root.id ? null : (parentNodeId ?? null),
        ignored: false,
        colorKey: n.colorKey ?? null,
      };
    });
}

// Map a single-thread detail response onto the list view-model item, reusing the
// summary mapping. Used to inject a thread that isn't in the current list (e.g.
// opened from a notification deep-link) so the preview can render it.
export function mapThreadDetail(detail: EmailThreadDetail): ThreadItem {
  const summary: EmailThreadSummary = {
    id: detail.id,
    subject: detail.subject,
    provider: detail.provider,
    providerThreadId: detail.providerThreadId,
    webLink: detail.webLink,
    latestMessageAt: detail.latestMessageAt,
    messageCount: detail.messageCount,
    triageStatus: detail.triageStatus,
    isClassifying: detail.isClassifying,
    isQueued: detail.isQueued,
    createdAt: detail.createdAt,
    isImportant: detail.isImportant,
    // The detail endpoint returns messages oldest-first; the summary mapping
    // expects newest-first (it reads messages[0] for the snippet), so reverse.
    messages: detail.messages
      .map((m) => ({
        id: m.id,
        senderEmail: m.senderEmail,
        senderName: m.senderName,
        snippet: m.snippet,
        receivedAt: m.receivedAt,
        hasAttachments: m.hasAttachments,
        attachments: m.attachments,
      }))
      .reverse(),
    tags: detail.tags,
    // The summary carries only the fields mapThreads reads (finalNode, confidence);
    // the detail's Classification is wider, so project it down.
    latestClassification: detail.latestClassification
      ? {
          id: detail.latestClassification.id,
          priority: detail.latestClassification.priority ?? "",
          urgency: detail.latestClassification.urgency ?? "",
          confidence: detail.latestClassification.confidence,
          needsHumanReview: detail.latestClassification.needsHumanReview,
          // A run that ended in needs-review chose no destination while the
          // thread stayed filed where the run before it put it, so the folder
          // comes from the detail's own answer to "where is this filed" rather
          // than from the last run alone.
          finalNode: detail.latestClassification.finalNode ?? detail.filedNode,
        }
      : null,
    hasDraft: detail.hasDraft,
    isDrafting: detail.isDrafting,
    doneMark: detail.doneMark,
    assignment: detail.assignment,
    // The detail endpoint carries no comment meta (the comments section fetches
    // its own); a deep-link-injected row starts without the comments tag and
    // picks up real counts on the next list refresh.
    commentCount: 0,
    unreadCommentCount: 0,
  };
  return mapThreads([summary])[0]!;
}

export function mapThreads(threads: EmailThreadSummary[]): ThreadItem[] {
  return threads.map((t) => {
    const cls = t.latestClassification;
    const folderId = cls?.finalNode?.id ?? null;

    let status: ThreadItem["status"] = "unsorted";
    if (t.triageStatus === "SORTED")             status = "sorted";
    else if (t.triageStatus === "NEEDS_REVIEW")  status = "review";
    else if (t.triageStatus === "UNROUTED")      status = "unrouted";
    else if (t.triageStatus === "UNCLASSIFIED")  status = "unclassified";

    const senders = t.messages
      .map((m) => m.senderName ?? m.senderEmail)
      .filter(Boolean);
    const participants =
      [...new Set(senders)].join(", ") || "Unknown";

    return {
      id: t.id,
      subject: t.subject ?? "(no subject)",
      provider: t.provider,
      providerThreadId: t.providerThreadId,
      webLink: t.webLink,
      participants,
      latestAt: t.latestMessageAt
        ? new Date(t.latestMessageAt)
        : new Date(t.createdAt),
      messageCount: t.messageCount,
      snippet: t.messages[0]?.snippet ?? "",
      unread: false,
      folderId,
      status,
      confidence: cls?.confidence ?? 0,
      reasoning: null,
      alternativeFolder: null,
      hasDraft: t.hasDraft,
      isDrafting: t.isDrafting,
      lastSenderEmail: t.messages.length > 0
        ? (t.messages[t.messages.length - 1]?.senderEmail ?? null)
        : null,
      doneMark: t.doneMark ?? null,
      assignment: t.assignment ?? null,
      isImportant: t.isImportant,
      isClassifying: t.isClassifying,
      attachmentCount: t.messages.reduce((sum, m) => sum + m.attachments.length, 0),
      commentCount: t.commentCount,
      unreadCommentCount: t.unreadCommentCount,
      messages: t.messages.map((m) => ({
        id: m.id,
        fromName: m.senderName ?? m.senderEmail,
        fromEmail: m.senderEmail,
        time: new Date(m.receivedAt),
        snippet: m.snippet,
        bodyText: null,
      })),
    };
  });
}

/**
 * ThreadItem.messages is newest-first (the list snippet reads messages[0]); the
 * thread previews render oldest-first and expand the last card as "the latest
 * message". This is the one sanctioned bridge between those two orders — sorting
 * by time rather than reversing, so it is correct regardless of which order the
 * caller's array arrived in.
 */
export function chronologicalMessages<T extends { time: Date }>(messages: T[]): T[] {
  return [...messages].sort((a, b) => a.time.getTime() - b.time.getTime());
}
