/**
 * One thread reached a terminal sorting outcome.
 *
 * Ids only — the stream carries no email content, and a consumer that wants
 * detail refetches the thread. `providerThreadId` is what lets a surface that
 * knows a thread only by the mailbox's id (the panel injected into
 * Gmail/Outlook) recognize its own thread.
 */
export type WorkspaceThreadEvent = {
  type: "classified" | "quota_blocked";
  threadId: string;
  providerThreadId: string;
};

/**
 * Parse a `thread` SSE frame. Anything malformed returns null rather than
 * throwing: this runs inside the stream read loop, and one bad frame must not
 * tear down a live connection. A server newer than this build may add event
 * types, so `type` is validated against the two we act on.
 */
export function parseThreadEvent(data: string): WorkspaceThreadEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (p["type"] !== "classified" && p["type"] !== "quota_blocked") return null;
    if (typeof p["threadId"] !== "string" || typeof p["providerThreadId"] !== "string") return null;
    return {
      type: p["type"],
      threadId: p["threadId"],
      providerThreadId: p["providerThreadId"],
    };
  } catch {
    return null;
  }
}
