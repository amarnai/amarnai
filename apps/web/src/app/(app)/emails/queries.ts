import type {
  EmailThreadSummary,
  TaxonomyNode,
  TaxonomyEdge,
} from "@/lib/api";
import type { FolderItem, ThreadItem } from "./selection";

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
      };
    });
}

export function mapThreads(threads: EmailThreadSummary[]): ThreadItem[] {
  return threads.map((t) => {
    const cls = t.latestClassification;
    const folderId = cls?.finalNode?.id ?? null;

    let status: ThreadItem["status"] = "unsorted";
    if (t.triageStatus === "SORTED") status = "sorted";
    else if (t.triageStatus === "NEEDS_REVIEW") status = "review";

    const senders = t.messages
      .map((m) => m.senderName ?? m.senderEmail)
      .filter(Boolean);
    const participants =
      [...new Set(senders)].join(", ") || "Unknown";

    return {
      id: t.id,
      subject: t.subject ?? "(no subject)",
      providerThreadId: t.providerThreadId,
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
