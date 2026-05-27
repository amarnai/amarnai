import { decrypt } from "./encryption.js";

// ─── Internal Gmail History API shapes ────────────────────────────────────────

type GmailHistoryMessage = { threadId?: string };

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

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
const GMAIL_THREAD_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
const GMAIL_HISTORY_URL = "https://gmail.googleapis.com/gmail/v1/users/me/history";

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
  /** New cursor to persist in ProviderSyncState.historyId after processing. */
  newHistoryId: string;
};

/** Lightweight metadata for a thread returned by listThreadsInWindow. */
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
};

export type GmailThreadWindowResult = {
  threads: GmailThreadMeta[];
  /** Total threads found in the window before the maxResults cap was applied. */
  totalFound: number;
};

export class GmailClient {
  constructor(private readonly encryptedRefreshToken: string) {}

  async refreshAccessToken(): Promise<string> {
    const refreshToken = decrypt(this.encryptedRefreshToken);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env["AUTH_GOOGLE_ID"] ?? "",
        client_secret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = (await res.json()) as TokenResponse;
    return data.access_token;
  }

  async getProfile(): Promise<GmailProfile> {
    const accessToken = await this.refreshAccessToken();
    const res = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail profile fetch failed: ${res.status}`);
    return res.json() as Promise<GmailProfile>;
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
  async listHistory(sinceHistoryId: string): Promise<GmailHistoryResult> {
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

    // Collect thread IDs from every change record, deduplicating.
    const seen = new Set<string>();
    for (const record of allHistory) {
      const entries = [
        ...(record.messagesAdded ?? []),
        ...(record.labelsAdded ?? []),
        ...(record.labelsRemoved ?? []),
      ];
      for (const entry of entries) {
        const tid = entry.message?.threadId;
        if (tid) seen.add(tid);
      }
    }

    return { changedThreadIds: Array.from(seen), newHistoryId: latestHistoryId };
  }

  /**
   * Lists Gmail threads with activity after `afterMs` (Unix ms timestamp),
   * fetching metadata-only to determine UNREAD status and latest message time.
   *
   * Pages through threads.list until `maxResults` IDs are collected or there
   * are no more pages. Returns `totalFound` as the pre-cap thread count so the
   * caller can compute how many threads were skipped.
   */
  async listThreadsInWindow(opts: {
    afterMs: number;
    maxResults: number;
  }): Promise<GmailThreadWindowResult> {
    const accessToken = await this.refreshAccessToken();
    const afterSecs = Math.floor(opts.afterMs / 1000);

    // ── Phase 1: collect thread IDs via threads.list (IDs + snippets only) ───
    type ThreadListPage = {
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
    };

    const allIds: string[] = [];
    let nextPageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: `after:${afterSecs}`,
        maxResults: "100",
      });
      if (nextPageToken) params.set("pageToken", nextPageToken);

      const res = await fetch(`${GMAIL_THREADS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Gmail threads list failed: ${res.status}`);

      const data = (await res.json()) as ThreadListPage;
      const ids = (data.threads ?? []).map((t) => t.id);
      allIds.push(...ids);
      nextPageToken = data.nextPageToken;
    } while (nextPageToken && allIds.length < opts.maxResults);

    // Anything beyond the cap is recorded as skipped — ids we didn't fetch.
    const totalFound = allIds.length;
    const cappedIds = allIds.slice(0, opts.maxResults);

    // ── Phase 2: fetch METADATA for each capped thread (in batches of 50) ───
    type ThreadMetaResp = {
      messages?: Array<{
        labelIds?: string[];
        internalDate?: string;
      }>;
    };

    async function fetchMeta(id: string): Promise<GmailThreadMeta> {
      const params = new URLSearchParams({
        format: "METADATA",
        metadataHeaders: "Date",
      });
      const res = await fetch(
        `${GMAIL_THREAD_URL}/${encodeURIComponent(id)}?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return { id, unread: false, latestMessageAt: new Date(0), messageLabelIds: [] };

      const data = (await res.json()) as ThreadMetaResp;
      const messages = data.messages ?? [];
      const lastMsg = messages[messages.length - 1];
      const unread = messages.some((m) => m.labelIds?.includes("UNREAD") ?? false);
      const latestMessageAt = lastMsg?.internalDate
        ? new Date(Number(lastMsg.internalDate))
        : new Date(0);
      const messageLabelIds = messages.map((m) => m.labelIds ?? []);

      return { id, unread, latestMessageAt, messageLabelIds };
    }

    const threads: GmailThreadMeta[] = [];
    for (let i = 0; i < cappedIds.length; i += 50) {
      const batch = cappedIds.slice(i, i + 50);
      const results = await Promise.all(batch.map(fetchMeta));
      threads.push(...results);
    }

    return { threads, totalFound };
  }

  /**
   * Returns all thread IDs matching `q` (a Gmail search query), paged up to
   * `maxResults`. Useful for targeted passes like `in:trash after:X`.
   *
   * Note: unlike listThreadsInWindow this method does not fetch message
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

  async getThread(threadId: string): Promise<unknown> {
    const accessToken = await this.refreshAccessToken();
    const url = `${GMAIL_THREAD_URL}/${encodeURIComponent(threadId)}?format=full`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) throw new Error(`Gmail thread not found: ${threadId}`);
    if (!res.ok) throw new Error(`Gmail thread fetch failed: ${res.status}`);
    return res.json();
  }
}
