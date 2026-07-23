import type { ThreadSnapshot } from "@amarnai/ai";
import { decrypt } from "./encryption.js";
import { normalizeGmailThread, getHeader, parseFrom, extractEmails } from "./gmail-thread-adapter.js";

// ─── Internal Gmail History API shapes ────────────────────────────────────────

type GmailHistoryMessage = { threadId?: string; labelIds?: string[] };

type GmailHistoryEntry = { message?: GmailHistoryMessage };

type GmailHistoryRecord = {
  id: string;
  messagesAdded?: GmailHistoryEntry[];
  labelsAdded?: GmailHistoryEntry[];
  labelsRemoved?: GmailHistoryEntry[];
};

type GmailHistoryResponse = {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
};

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when the stored historyId is no longer valid (cursor expired). */
export class GmailHistoryCursorExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailHistoryCursorExpiredError";
  }
}

/**
 * Thrown when the OAuth refresh token is invalid or revoked (invalid_grant).
 * The caller should mark the Gmail connection as DISCONNECTED so the workspace
 * stops receiving sync attempts.
 */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/**
 * Thrown by {@link GmailClient.getThreadSnapshot} when a fetched thread cannot be
 * normalized (malformed data). Permanent for that one thread — callers skip it
 * rather than aborting a run, distinct from a transient fetch failure.
 */
export class GmailThreadParseError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "GmailThreadParseError";
  }
}

/**
 * Thrown by {@link GmailClient.getThreadSnapshot} when the provider definitively
 * reports the requested thread as gone (HTTP 404 on that thread). This is the
 * ONLY signal callers may treat as "thread deleted — skip it"; auth, rate-limit,
 * 5xx, and network failures are transient and must propagate so the caller
 * retries instead of silently losing the thread. Never detect deletion by
 * matching "not found" in an error message — a transient error can contain
 * that substring.
 */
export class GmailThreadNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailThreadNotFoundError";
  }
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
const GMAIL_THREAD_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_HISTORY_URL = "https://gmail.googleapis.com/gmail/v1/users/me/history";
const GMAIL_WATCH_URL = "https://gmail.googleapis.com/gmail/v1/users/me/watch";
const GMAIL_STOP_URL = "https://gmail.googleapis.com/gmail/v1/users/me/stop";

/**
 * Revokes the Google OAuth grant for the given encrypted refresh token.
 * Treats HTTP 400 (token already invalid/revoked) as success.
 * Returns true on success, false if the revocation call failed for any
 * other reason. Never logs the token.
 */
export async function revokeGoogleToken(encryptedRefreshToken: string): Promise<boolean> {
  let token: string;
  try {
    token = decrypt(encryptedRefreshToken);
  } catch {
    return false;
  }
  if (!token) return false;
  try {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

export type GmailHistoryResult = {
  /** Deduplicated thread IDs that were added or modified since the cursor. */
  changedThreadIds: string[];
  /**
   * Provider message IDs removed from the inbox scope. Always empty for Gmail:
   * an INBOX-label removal already surfaces its thread through a labelRemoved
   * history record (folded into `changedThreadIds`), so there is nothing to
   * resolve separately. Present only to satisfy the neutral MailChangeResult
   * shape the Outlook/Graph adapter uses for `@removed` delta entries.
   */
  removedMessageIds: string[];
  /**
   * Subset of {@link changedThreadIds} whose ONLY activity since the cursor is
   * messagesAdded entries that are outbound (SENT without INBOX) — i.e. the user
   * sent mail and nothing else touched the thread. The sync worker skips fetching
   * these when they are not already persisted, so a sent email awaiting a reply
   * is never imported.
   *
   * A thread is disqualified (removed from this list, so it is fetched normally)
   * by any labelsAdded/labelsRemoved entry, any non-outbound message, or any
   * entry with missing labelIds — unknown label data always fails open.
   */
  sentOnlyCandidateThreadIds: string[];
  /** New cursor to persist in ProviderSyncState.historyId after processing. */
  newCursor: string;
};

/** Lightweight metadata for a thread returned by listThreadsPage. */
export type GmailThreadMeta = {
  id: string;
  /** True if any message in the thread carries the UNREAD label. */
  unread: boolean;
  /** Timestamp of the most recent message in the thread. */
  latestMessageAt: Date;
  /**
   * Per-message label ID arrays, in message order.
   * Used by the backfill worker to compute thread-level label flags (spam, promotions, trash)
   * without a second full-thread fetch.
   */
  messageLabelIds: string[][];
  /**
   * Per-message sender address (lowercased, From header), in message order.
   * Lets the backfill worker detect sent-only threads by IDENTITY (the owner is
   * the sole sender) without a full fetch — robust where labels are unreliable.
   */
  messageSenders: string[];
  /**
   * Per-message recipient addresses (lowercased To + Cc), in message order.
   * Used together with {@link messageSenders} to keep notes-to-self importable
   * (the owner appears as a recipient) at the metadata stage.
   */
  messageRecipients: string[][];
};

export type GmailWatchResult = {
  /** Current historyId at the time the watch was registered. */
  historyId: string;
  /** Unix ms timestamp (as string) when the watch expires (~7 days). */
  expiration: string;
};

/**
 * OAuth client credentials for a refresh-token grant. All stored refresh tokens
 * are minted against the confidential Web client (id + secret): the web flow
 * exchanges the code server-side, and the mobile flow sends a serverAuthCode the
 * API exchanges with this same client. Google only allows server-side refresh
 * for this confidential client.
 */
function refreshClientCredentials(): Record<string, string> {
  return {
    client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
    client_secret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
  };
}

export class GmailClient {
  constructor(private readonly encryptedRefreshToken: string) {}

  async refreshAccessToken(): Promise<string> {
    const refreshToken = decrypt(this.encryptedRefreshToken);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        ...refreshClientCredentials(),
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      let code: string | undefined;
      try { code = ((await res.json()) as { error?: string }).error; } catch {}
      if (code === "invalid_grant" || res.status === 401) {
        throw new GmailAuthError(`Token refresh failed: ${code ?? res.status}`);
      }
      throw new Error(`Token refresh failed: ${res.status}`);
    }
    const data = (await res.json()) as TokenResponse;
    return data.access_token;
  }

  /**
   * The connected mailbox's identity and current sync cursor, in the neutral
   * shape the pipeline consumes. Gmail's `historyId` is the opaque `syncCursor`.
   */
  async getProfile(): Promise<{ emailAddress: string; syncCursor: string }> {
    const accessToken = await this.refreshAccessToken();
    const res = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail profile fetch failed: ${res.status}`);
    const data = (await res.json()) as GmailProfile;
    return { emailAddress: data.emailAddress, syncCursor: data.historyId };
  }

  async listRecentThreadIds(maxResults = 10): Promise<string[]> {
    const accessToken = await this.refreshAccessToken();
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail threads list failed: ${res.status}`);
    type ThreadList = { threads?: Array<{ id: string }> };
    const data = (await res.json()) as ThreadList;
    return (data.threads ?? []).map((t) => t.id);
  }

  async listRecentThreads(maxResults = 10): Promise<Array<{ id: string; subject: string | null }>> {
    const accessToken = await this.refreshAccessToken();
    const listParams = new URLSearchParams({ maxResults: String(maxResults) });
    const listRes = await fetch(`${GMAIL_THREADS_URL}?${listParams}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) throw new Error(`Gmail threads list failed: ${listRes.status}`);
    type ThreadList = { threads?: Array<{ id: string }> };
    const listData = (await listRes.json()) as ThreadList;
    const ids = (listData.threads ?? []).map((t) => t.id);

    return Promise.all(
      ids.map(async (id) => {
        const metaParams = new URLSearchParams({ format: "METADATA", metadataHeaders: "Subject" });
        const res = await fetch(`${GMAIL_THREAD_URL}/${encodeURIComponent(id)}?${metaParams}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return { id, subject: null };
        type ThreadMeta = { messages?: Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }> };
        const data = (await res.json()) as ThreadMeta;
        const subject =
          data.messages?.[0]?.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? null;
        return { id, subject };
      })
    );
  }

  /**
   * Fetches Gmail History since `sinceHistoryId` and returns:
   * - `changedThreadIds`: deduplicated thread IDs that received new or modified
   *   messages (covers messagesAdded, labelsAdded, labelsRemoved).
   * - `newHistoryId`: the cursor to persist after processing.
   *
   * Throws if the cursor is invalid (HTTP 404) — caller should treat this as a
   * full-resync signal and fall back to `listRecentThreadIds`.
   */
  async listChangesSince(sinceHistoryId: string): Promise<GmailHistoryResult> {
    const accessToken = await this.refreshAccessToken();

    // Collect all pages of history records.
    const allHistory: GmailHistoryRecord[] = [];
    let pageToken: string | undefined;
    let latestHistoryId = sinceHistoryId;

    do {
      const params = new URLSearchParams({
        startHistoryId: sinceHistoryId,
        maxResults: "500",
      });
      // Request all three change types so label mutations (spam, trash,
      // promotions) are caught in addition to newly-added messages.
      params.append("historyTypes", "messageAdded");
      params.append("historyTypes", "labelAdded");
      params.append("historyTypes", "labelRemoved");
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(`${GMAIL_HISTORY_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 404) {
        throw new GmailHistoryCursorExpiredError(
          `History cursor expired or invalid (historyId=${sinceHistoryId}). Perform a full resync.`
        );
      }
      if (!res.ok) throw new Error(`Gmail history fetch failed: ${res.status}`);

      const data = (await res.json()) as GmailHistoryResponse;
      if (data.history) allHistory.push(...data.history);
      if (data.historyId) latestHistoryId = data.historyId;
      pageToken = data.nextPageToken;
    } while (pageToken);

    // Collect thread IDs from every change record, deduplicating, while tracking
    // which threads are disqualified from being "sent-only candidates". A thread
    // is a candidate only if its ENTIRE delta is outbound messagesAdded (SENT
    // without INBOX). Any label mutation, any non-outbound message, or any entry
    // with missing labelIds disqualifies it — unknown label data fails open so
    // the thread is fetched normally. All pages are already accumulated into
    // allHistory, so a thread whose entries span pages is classified correctly.
    //
    // The outbound rule below is a private copy of isOutboundLabelSet in
    // apps/worker/src/jobs/filter-thread-messages.ts (this package cannot import
    // worker code). Keep the two in sync.
    const seen = new Set<string>();
    const notCandidate = new Set<string>();
    for (const record of allHistory) {
      for (const entry of record.messagesAdded ?? []) {
        const tid = entry.message?.threadId;
        if (!tid) continue;
        seen.add(tid);
        const labels = entry.message?.labelIds;
        const outbound = !!labels && labels.includes("SENT") && !labels.includes("INBOX");
        if (!outbound) notCandidate.add(tid);
      }
      for (const entry of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
        const tid = entry.message?.threadId;
        if (!tid) continue;
        seen.add(tid);
        notCandidate.add(tid);
      }
    }

    const changedThreadIds = Array.from(seen);
    // Gmail folds inbox removals into changedThreadIds via labelRemoved records,
    // so there is never a separate message ID to resolve.
    return {
      changedThreadIds,
      removedMessageIds: [],
      sentOnlyCandidateThreadIds: changedThreadIds.filter((id) => !notCandidate.has(id)),
      newCursor: latestHistoryId,
    };
  }

  /**
   * Fetch metadata (UNREAD status, latest message time, per-message label IDs)
   * for a list of thread IDs, in batches of 50. Returns one GmailThreadMeta per
   * input ID; threads whose metadata fetch fails get a safe empty placeholder.
   */
  private async fetchThreadMetaForIds(
    ids: string[],
    accessToken: string
  ): Promise<GmailThreadMeta[]> {
    type MetaHeader = { name: string; value: string };
    type ThreadMetaResp = {
      messages?: Array<{
        labelIds?: string[];
        internalDate?: string;
        payload?: { headers?: MetaHeader[] };
      }>;
    };

    const emptyMeta = (id: string): GmailThreadMeta => ({
      id,
      unread: false,
      latestMessageAt: new Date(0),
      messageLabelIds: [],
      messageSenders: [],
      messageRecipients: [],
    });

    const fetchMeta = async (id: string): Promise<GmailThreadMeta> => {
      // Date drives latestMessageAt; From/To/Cc let the backfill worker detect
      // sent-only threads by identity (owner is the sole sender) without a full
      // fetch. Parsed with the SAME helpers the full adapter uses, so the
      // metadata verdict can never disagree with the post-fetch snapshot.
      const params = new URLSearchParams({ format: "METADATA" });
      for (const h of ["Date", "From", "To", "Cc"]) params.append("metadataHeaders", h);
      const res = await fetch(
        `${GMAIL_THREAD_URL}/${encodeURIComponent(id)}?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return emptyMeta(id);

      const data = (await res.json()) as ThreadMetaResp;
      const messages = data.messages ?? [];
      const lastMsg = messages[messages.length - 1];
      const unread = messages.some((m) => m.labelIds?.includes("UNREAD") ?? false);
      const latestMessageAt = lastMsg?.internalDate
        ? new Date(Number(lastMsg.internalDate))
        : new Date(0);
      const messageLabelIds = messages.map((m) => m.labelIds ?? []);
      const messageSenders = messages.map((m) => {
        const headers = m.payload?.headers ?? [];
        return parseFrom(getHeader(headers, "From") ?? "").email;
      });
      const messageRecipients = messages.map((m) => {
        const headers = m.payload?.headers ?? [];
        return [
          ...extractEmails(getHeader(headers, "To") ?? ""),
          ...extractEmails(getHeader(headers, "Cc") ?? ""),
        ].map((e) => e.toLowerCase());
      });

      return { id, unread, latestMessageAt, messageLabelIds, messageSenders, messageRecipients };
    };

    const threads: GmailThreadMeta[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const results = await Promise.all(batch.map(fetchMeta));
      threads.push(...results);
    }
    return threads;
  }

  /**
   * Fetch a single page of threads with activity after `afterMs` (Unix ms;
   * 0 means full history), resuming from `pageToken` when provided. Returns the
   * page's thread metadata plus nextPageToken (undefined when no further pages).
   *
   * Used by the resumable backfill: the caller persists nextPageToken between
   * chunks so a large historical scan can span many job runs without loading
   * every thread ID into memory up front.
   */
  async listThreadsPage(opts: {
    afterMs: number;
    pageToken?: string | undefined;
    pageSize?: number | undefined;
  }): Promise<{
    threads: GmailThreadMeta[];
    nextPageToken: string | undefined;
    // Gmail's estimate of the total number of threads matching the query (across
    // all pages). Approximate; used to surface how many threads sit beyond the
    // plan cap.
    resultSizeEstimate: number;
  }> {
    const accessToken = await this.refreshAccessToken();
    // Gmail special-cases `after:0` as "match nothing" rather than "all mail", so
    // a full-history scan (afterMs = 0, used by the no-window plans) would return
    // zero threads. Clamp to at least 1 second past the epoch, which Gmail treats
    // as "everything" while keeping the default spam/trash exclusion.
    const afterSecs = Math.max(1, Math.floor(opts.afterMs / 1000));

    const params = new URLSearchParams({
      q: `after:${afterSecs}`,
      maxResults: String(opts.pageSize ?? 100),
    });
    if (opts.pageToken) params.set("pageToken", opts.pageToken);

    const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail threads list failed: ${res.status}`);

    type ThreadListPage = {
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    };
    const data = (await res.json()) as ThreadListPage;
    const ids = (data.threads ?? []).map((t) => t.id);
    const threads = await this.fetchThreadMetaForIds(ids, accessToken);

    return {
      threads,
      nextPageToken: data.nextPageToken,
      resultSizeEstimate: data.resultSizeEstimate ?? 0,
    };
  }

  /**
   * Returns all thread IDs matching `q` (a Gmail search query), paged up to
   * `maxResults`. Useful for targeted passes like `in:trash after:X`.
   *
   * Note: unlike listThreadsPage this method does not fetch message
   * metadata — it returns bare IDs only.
   */
  async listThreadIdsByQuery(q: string, maxResults: number): Promise<string[]> {
    const accessToken = await this.refreshAccessToken();
    const allIds: string[] = [];
    let nextPageToken: string | undefined;

    do {
      const params = new URLSearchParams({ q, maxResults: "100" });
      if (nextPageToken) params.set("pageToken", nextPageToken);

      const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Gmail threads list failed: ${res.status}`);

      type ThreadListPage = { threads?: Array<{ id: string }>; nextPageToken?: string };
      const data = (await res.json()) as ThreadListPage;
      allIds.push(...(data.threads ?? []).map((t) => t.id));
      nextPageToken = data.nextPageToken;
    } while (nextPageToken && allIds.length < maxResults);

    return allIds.slice(0, maxResults);
  }

  /**
   * Registers a Gmail push notification watch for this inbox.
   * Gmail will publish a message to `topicName` (a Cloud Pub/Sub topic) whenever
   * the inbox changes. The watch expires after ~7 days and must be renewed.
   *
   * The Pub/Sub topic must have the Gmail service account
   * (gmail-api-push@system.gserviceaccount.com) granted the Publisher role —
   * this is operator infrastructure set up once, not per-user.
   */
  async registerWatch(topicName: string): Promise<{ cursor: string; expiresAt: string }> {
    const accessToken = await this.refreshAccessToken();
    const res = await fetch(GMAIL_WATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicName,
        labelIds: ["INBOX"],
        labelFilterAction: "include",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail watch failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as GmailWatchResult;
    return { cursor: data.historyId, expiresAt: data.expiration };
  }

  /**
   * Stops the Gmail push notification watch for this inbox.
   * Must be called before revoking the OAuth token so the token is still
   * valid when making this request.
   */
  async stopWatch(): Promise<void> {
    const accessToken = await this.refreshAccessToken();
    const res = await fetch(GMAIL_STOP_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail watch stop failed: ${res.status}`);
    }
  }

  async getThread(threadId: string): Promise<unknown> {
    const accessToken = await this.refreshAccessToken();
    const url = `${GMAIL_THREAD_URL}/${encodeURIComponent(threadId)}?format=full`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) throw new GmailThreadNotFoundError(`Gmail thread not found: ${threadId}`);
    if (!res.ok) throw new Error(`Gmail thread fetch failed: ${res.status}`);
    return res.json();
  }

  /**
   * Fetch a thread and normalize it to a {@link ThreadSnapshot}. Folds the raw
   * fetch and the Gmail normalizer so callers never handle raw Gmail JSON.
   */
  async getThreadSnapshot(threadId: string): Promise<ThreadSnapshot> {
    const raw = await this.getThread(threadId);
    try {
      return normalizeGmailThread(raw);
    } catch (err) {
      throw new GmailThreadParseError(err);
    }
  }

  /**
   * Fetch the raw bytes of one message attachment, used to serve CID inline
   * images. Gmail's endpoint returns base64url data and no content type, so
   * `mimeType` is always null here — the image-proxy route sniffs the bytes.
   * Attachment IDs are ephemeral (they rotate between fetches); callers pass a
   * fresh ID obtained from a recent `getThreadSnapshot`. Never logs the payload.
   */
  async getAttachmentContent(
    providerMessageId: string,
    attachmentId: string
  ): Promise<{ data: Uint8Array; mimeType: string | null; size: number }> {
    const accessToken = await this.refreshAccessToken();
    const url = `${GMAIL_MESSAGES_URL}/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(attachmentId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail attachment fetch failed: ${res.status}`);
    const json = (await res.json()) as { size?: number; data?: string };
    if (!json.data) throw new Error("Gmail attachment response had no data");
    const base64 = json.data.replace(/-/g, "+").replace(/_/g, "/");
    const data = new Uint8Array(Buffer.from(base64, "base64"));
    return { data, mimeType: null, size: json.size ?? data.byteLength };
  }
}
