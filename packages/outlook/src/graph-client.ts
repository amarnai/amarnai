import type { ThreadSnapshot } from "@aziru/ai";
// Neutral control-flow errors are canonical in @aziru/gmail and re-exported by
// @aziru/mail as MailAuthError / MailCursorExpiredError. GraphClient throws the
// SAME classes so the worker's `instanceof Mail*Error` branches match, without a
// package cycle (outlook -> gmail only).
import {
  decrypt,
  GmailAuthError as MailAuthError,
  GmailHistoryCursorExpiredError as MailCursorExpiredError,
  GmailThreadNotFoundError as MailThreadNotFoundError,
} from "@aziru/gmail";
import { normalizeGraphThread, type GraphMessage } from "./normalize-graph-thread.js";
import {
  OUTLOOK_SCOPES,
  OUTLOOK_WRITEBACK_SCOPES,
  hasWritebackScope,
} from "./microsoft-oauth.js";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

function tenant(): string {
  return process.env["MS_GRAPH_TENANT"] || "common";
}

function tokenUrl(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
}

// Message fields the classifier snapshot needs. internetMessageHeaders must be
// explicitly selected (it is not returned by default). parentFolderId and isDraft
// drive the snapshot's folder partition (see getThreadSnapshot); sentDateTime is
// the timestamp fallback for Sent Items copies.
const MESSAGE_SELECT =
  "id,conversationId,parentFolderId,isDraft,from,sender,toRecipients,ccRecipients,subject," +
  "receivedDateTime,sentDateTime,bodyPreview,uniqueBody,body,hasAttachments,isRead,webLink," +
  "internetMessageHeaders";
const ATTACHMENT_EXPAND = "attachments($select=id,name,contentType,size,isInline)";

// The inbox folder is the CHANGE-DETECTION scope: listing, delta and the webhook
// subscription all track it, so a message archived / deleted / moved out of the
// inbox registers as a removal. Thread CONTENT is a wider set — see
// getThreadSnapshot, which reads the mailbox and partitions by folder.
const INBOX_MESSAGES = "/me/mailFolders/inbox/messages";

// Sent Items is tracked by delta as well, but ONLY as a change signal: a reply
// the user sends never touches the inbox, so without this the thread would not
// re-sync and the reply would never be persisted. See listChangesSince.
const SENT_MESSAGES = "/me/mailFolders/sentitems/messages";

// Mailbox-wide message collection, used only by getThreadSnapshot.
const ALL_MESSAGES = "/me/messages";

/**
 * Outlook needs TWO delta cursors (inbox + Sent Items) where the pipeline stores
 * one opaque string. Both are carried in that one value as JSON rather than by
 * adding a provider-specific column: `ProviderSyncState.historyId` is contracted
 * as an opaque provider cursor, so its internal shape is this adapter's business.
 *
 * `sent` is optional so a cursor stored before Sent Items was tracked still
 * parses — see {@link parseOutlookCursor}.
 */
type OutlookSyncCursor = { inbox: string; sent?: string };

/**
 * Cursors written before Sent Items tracking existed are a bare Graph deltaLink
 * URL, not JSON. Those are read as inbox-only, and listChangesSince establishes
 * the missing Sent Items cursor at "now" on the next sync. That upgrade is
 * deliberately non-retroactive: adopting the sent cursor at "now" imports no
 * history, whereas walking Sent Items from the beginning would re-surface every
 * thread the user has ever replied to as changed, in one sync. The one-off
 * repair script backfills that history instead.
 */
function parseOutlookCursor(cursor: string): OutlookSyncCursor {
  if (!cursor.trimStart().startsWith("{")) return { inbox: cursor };
  try {
    const parsed = JSON.parse(cursor) as Partial<OutlookSyncCursor>;
    if (typeof parsed.inbox !== "string" || parsed.inbox.length === 0) return { inbox: cursor };
    return typeof parsed.sent === "string" && parsed.sent.length > 0
      ? { inbox: parsed.inbox, sent: parsed.sent }
      : { inbox: parsed.inbox };
  } catch {
    // Not JSON after all — treat the whole value as the inbox deltaLink.
    return { inbox: cursor };
  }
}

function serializeOutlookCursor(cursor: OutlookSyncCursor): string {
  return JSON.stringify(cursor);
}

/**
 * The two well-known folders whose messages make up a thread snapshot: the inbox
 * (what the other party sent us) and Sent Items (the owner's own replies, which
 * Gmail's `threads.get` returns natively and Outlook keeps in a separate folder).
 *
 * Resolved from Graph's locale-independent well-known names (`inbox`,
 * `sentitems`), never from display names, which are localised per mailbox.
 */
type SnapshotFolderIds = { inbox: string; sent: string };

type TokenResponse = { access_token: string; expires_in: number };

/**
 * Build a human-readable reason from a failed Graph response so a bare status
 * code (notably a 401) carries WHY Graph rejected the request. Reads two sources,
 * both best-effort:
 *   - the `WWW-Authenticate` challenge, present on 401s — it names the failure
 *     (`invalid_token`, `insufficient_claims` for a Conditional Access / CAE
 *     challenge, an expired token, or an audience mismatch);
 *   - the JSON error body (`error.code` / `error.message`).
 * Truncated because this is diagnostic, not exhaustive. Consumes the response
 * body, so only call it on an already-failed response that will not be read again.
 */
async function describeGraphError(res: Response): Promise<string> {
  const parts: string[] = [];
  const challenge = res.headers.get("WWW-Authenticate");
  if (challenge) parts.push(challenge.length > 300 ? `${challenge.slice(0, 300)}…` : challenge);
  try {
    const body = (await res.text()).trim();
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
        const joined = [parsed.error?.code, parsed.error?.message].filter(Boolean).join(": ");
        parts.push(joined || body.slice(0, 300));
      } catch {
        parts.push(body.slice(0, 300));
      }
    }
  } catch {
    /* body unavailable or already consumed */
  }
  return parts.join(" | ");
}

/**
 * A message entry in a delta page. Graph interleaves full/changed messages with
 * tombstones: an item removed from the tracked folder appears as `{ id,
 * "@removed": { reason } }` and carries no other fields (notably no
 * conversationId), so removed entries must be recognised by the `@removed`
 * marker, not by a missing conversationId on an otherwise-normal message.
 */
type GraphDeltaEntry = GraphMessage & { "@removed"?: { reason?: string } };

type GraphListResponse<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

/**
 * Read-only Microsoft Graph adapter. Structurally conforms to the `MailProvider`
 * contract (asserted in the createMailProvider factory) without importing it, to
 * keep the package graph acyclic. Every data request carries
 * `Prefer: IdType="ImmutableId"` so message ids survive folder moves.
 */
export class GraphClient {
  // When the connection holds the write scope, refresh must request the writeback
  // set — Microsoft refresh tokens are scope-bound, so a read-only refresh would
  // mint a token that cannot write categories. Defaults to the read-only set.
  private readonly refreshScope: string;

  /** Memoised {@link snapshotFolderIds} result; see that method for the caching rules. */
  private folderIds: Promise<SnapshotFolderIds> | null = null;

  constructor(
    private readonly encryptedRefreshToken: string,
    grantedScopes?: string[],
  ) {
    this.refreshScope =
      grantedScopes && hasWritebackScope(grantedScopes)
        ? OUTLOOK_WRITEBACK_SCOPES
        : OUTLOOK_SCOPES;
  }

  async refreshAccessToken(): Promise<string> {
    const refreshToken = decrypt(this.encryptedRefreshToken);
    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env["MS_GRAPH_CLIENT_ID"] ?? "",
        client_secret: process.env["MS_GRAPH_CLIENT_SECRET"] ?? "",
        grant_type: "refresh_token",
        scope: this.refreshScope,
      }),
    });
    if (!res.ok) {
      let code: string | undefined;
      try {
        code = ((await res.json()) as { error?: string }).error;
      } catch {
        /* ignore body parse errors */
      }
      if (code === "invalid_grant" || res.status === 401) {
        throw new MailAuthError(`Token refresh failed: ${code ?? res.status}`);
      }
      throw new Error(`Token refresh failed: ${res.status}`);
    }
    const data = (await res.json()) as TokenResponse;
    return data.access_token;
  }

  /**
   * Authenticated GET against an absolute Graph URL (or one deltaLink/nextLink
   * follow-up), honoring a single `Retry-After` on 429 (Graph throttles harder
   * than Gmail and sends the header). 410 Gone on a delta URL is surfaced as a
   * cursor-expiry so the caller falls back to a full resync.
   */
  private async graphGet<T>(
    url: string,
    accessToken: string,
    opts?: { maxPageSize?: number },
  ): Promise<GraphListResponse<T>> {
    return this.graphGetJson<GraphListResponse<T>>(url, accessToken, opts);
  }

  /**
   * The request/retry/error handling behind {@link graphGet}, returning the parsed
   * body as-is. Single-entity reads (a mailFolder) use this directly rather than
   * being forced through the collection shape.
   */
  private async graphGetJson<T>(
    url: string,
    accessToken: string,
    opts?: { maxPageSize?: number },
  ): Promise<T> {
    const prefer =
      'IdType="ImmutableId"' +
      (opts?.maxPageSize ? `, odata.maxpagesize=${opts.maxPageSize}` : "");
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: prefer,
        },
      });
      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 1;
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
        continue;
      }
      if (res.status === 410) {
        throw new MailCursorExpiredError("Delta cursor expired (410 Gone). Perform a full resync.");
      }
      if (res.status === 401) {
        // A 401 on a DATA request means the access token we just minted was
        // rejected by Graph — the token refresh itself succeeded (that path throws
        // its own MailAuthError). Retrying with the same refresh token cannot fix
        // it: the cause is auth/consent (a Conditional Access / CAE claims
        // challenge, a revoked or unconsented permission, an audience mismatch).
        // Classify as MailAuthError — parity with Gmail's auth handling — so the
        // worker surfaces "reconnect needed" instead of retrying forever, and
        // carry the WWW-Authenticate / body reason so the cause is diagnosable.
        const detail = await describeGraphError(res);
        throw new MailAuthError(`Graph request failed: 401${detail ? ` — ${detail}` : ""}`);
      }
      if (res.status === 404) throw new Error(`Graph resource not found: ${res.status}`);
      if (!res.ok) {
        const detail = await describeGraphError(res);
        throw new Error(`Graph request failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
      }
      return (await res.json()) as T;
    }
    // Unreachable in practice: the retry either returns or throws above.
    throw new Error("Graph request failed after retry");
  }

  /**
   * Resolve and cache the inbox / Sent Items folder ids for this mailbox.
   *
   * Cached on the instance because the ids are stable for the life of the
   * mailbox, and a client is constructed once per sync / backfill run that then
   * snapshots many threads — so this costs two requests per run, not per thread.
   *
   * The ids MUST be obtained through {@link graphGetJson}, which sends
   * `Prefer: IdType="ImmutableId"` exactly as the message query does: `id` and
   * `parentFolderId` are only comparable when both sides were read under the same
   * id-type preference.
   */
  private snapshotFolderIds(accessToken: string): Promise<SnapshotFolderIds> {
    if (this.folderIds) return this.folderIds;
    const pending = (async () => {
      const [inbox, sent] = await Promise.all([
        this.wellKnownFolderId("inbox", accessToken),
        this.wellKnownFolderId("sentitems", accessToken),
      ]);
      return { inbox, sent };
    })();
    this.folderIds = pending;
    // A failed resolution must not stick: clear the cache so the next call
    // retries instead of replaying the rejection for the client's whole life.
    pending.catch(() => {
      if (this.folderIds === pending) this.folderIds = null;
    });
    return pending;
  }

  private async wellKnownFolderId(name: string, accessToken: string): Promise<string> {
    const folder = await this.graphGetJson<{ id?: string }>(
      `${GRAPH_BASE_URL}/me/mailFolders/${name}?$select=id`,
      accessToken,
    );
    if (!folder.id) throw new Error(`Graph well-known folder '${name}' returned no id`);
    return folder.id;
  }

  /** Follow `@odata.nextLink` until the collection is exhausted. */
  private async fetchAllPages(firstUrl: string, accessToken: string): Promise<GraphMessage[]> {
    const out: GraphMessage[] = [];
    let next: string | undefined = firstUrl;
    while (next !== undefined) {
      const page: GraphListResponse<GraphMessage> = await this.graphGet<GraphMessage>(
        next,
        accessToken,
      );
      out.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return out;
  }

  async getProfile(): Promise<{ emailAddress: string; syncCursor: string }> {
    const accessToken = await this.refreshAccessToken();

    const meRes = await fetch(`${GRAPH_BASE_URL}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      const detail = await describeGraphError(meRes);
      // Same rationale as graphGet: a 401 here is a rejected access token, not a
      // transient fault — classify it as MailAuthError so the connection surfaces
      // as needing re-auth rather than retrying indefinitely.
      if (meRes.status === 401) {
        throw new MailAuthError(`Graph /me fetch failed: 401${detail ? ` — ${detail}` : ""}`);
      }
      throw new Error(`Graph /me fetch failed: ${meRes.status}${detail ? ` — ${detail}` : ""}`);
    }
    const me = (await meRes.json()) as { mail?: string | null; userPrincipalName?: string };
    const emailAddress = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();

    // Establish both delta cursors at "now" without importing anything.
    const [inbox, sent] = await Promise.all([
      this.establishDeltaCursor(INBOX_MESSAGES, accessToken),
      this.establishDeltaCursor(SENT_MESSAGES, accessToken),
    ]);
    return { emailAddress, syncCursor: serializeOutlookCursor({ inbox, sent }) };
  }

  /**
   * Point a folder's delta cursor at "now" without importing anything.
   *
   * Work/school mailboxes honor `$deltatoken=latest` (empty response with an
   * immediate deltaLink), but consumer outlook.com mailboxes ignore it and
   * enumerate the folder in pages instead — so follow nextLink pages, discarding
   * the entries, until the terminal deltaLink appears. The large page size keeps
   * that walk to ~1 request per 200 messages, and it only runs when a cursor is
   * first established. There is deliberately no empty-string fallback: persisting
   * "" as a cursor is indistinguishable from "no cursor", which re-enters this
   * branch on every sync and silently disables incremental sync forever — a chain
   * that ends without a deltaLink must fail loudly instead.
   */
  private async establishDeltaCursor(folderPath: string, accessToken: string): Promise<string> {
    let url = `${GRAPH_BASE_URL}${folderPath}/delta?$deltatoken=latest`;
    for (;;) {
      const page = await this.graphGet<GraphMessage>(url, accessToken, { maxPageSize: 200 });
      if (page["@odata.deltaLink"]) return page["@odata.deltaLink"];
      if (!page["@odata.nextLink"]) {
        throw new Error(
          `Graph ${folderPath} delta ended without a deltaLink — cannot establish a sync cursor`,
        );
      }
      url = page["@odata.nextLink"];
    }
  }

  /** Follow a delta chain to its terminal deltaLink, collecting every entry. */
  private async walkDelta(
    startUrl: string,
    accessToken: string,
  ): Promise<{ entries: GraphDeltaEntry[]; newCursor: string }> {
    const entries: GraphDeltaEntry[] = [];
    let url = startUrl;
    let newCursor = startUrl;
    for (;;) {
      const page: GraphListResponse<GraphDeltaEntry> = await this.graphGet<GraphDeltaEntry>(
        url,
        accessToken,
      );
      entries.push(...(page.value ?? []));
      if (page["@odata.deltaLink"]) {
        newCursor = page["@odata.deltaLink"];
        break;
      }
      if (!page["@odata.nextLink"]) break;
      url = page["@odata.nextLink"];
    }
    return { entries, newCursor };
  }

  async listChangesSince(cursor: string): Promise<{
    changedThreadIds: string[];
    removedMessageIds: string[];
    sentOnlyCandidateThreadIds: string[];
    newCursor: string;
  }> {
    const accessToken = await this.refreshAccessToken();
    const stored = parseOutlookCursor(cursor);

    const seen = new Set<string>();
    const removed = new Set<string>();

    /**
     * A message archived / deleted / moved out of the tracked folder surfaces as
     * an `@removed` entry carrying only its id (no conversationId). For the inbox
     * that is an inbox-membership removal (a move to Archive is indistinguishable
     * from a delete); for Sent Items it is the user deleting their own sent copy.
     * Either way the caller resolves the id to its thread from persisted data and
     * re-sorts it, which drops the row (Gmail parity: an INBOX-label removal
     * re-sorts the whole thread). A normal created/updated entry carries a
     * conversationId and re-sorts its thread directly.
     */
    const collect = (entries: GraphDeltaEntry[], onConversation?: (id: string) => void) => {
      for (const entry of entries) {
        if (entry["@removed"]) {
          if (entry.id) removed.add(entry.id);
        } else if (entry.conversationId) {
          onConversation?.(entry.conversationId);
          seen.add(entry.conversationId);
        }
      }
    };

    const inbox = await this.walkDelta(stored.inbox, accessToken);
    collect(inbox.entries);

    // ── Sent Items ────────────────────────────────────────────────────────────
    // Tracked purely as a change SIGNAL. A reply the user sends from Outlook never
    // touches the inbox, so without this the thread never re-syncs and the reply
    // is never persisted — the snapshot already returns Sent Items messages, but
    // nothing would call it. Thread CONTENT still comes from getThreadSnapshot,
    // and the not-found / removal rules stay inbox-derived there.
    const sentOnlyCandidates = new Set<string>();
    let sentCursor = stored.sent;
    if (sentCursor === undefined) {
      // Upgrade from an inbox-only cursor: adopt Sent Items at "now". Walking it
      // from the beginning would report every thread the user has ever replied to
      // as changed in a single sync.
      sentCursor = await this.establishDeltaCursor(SENT_MESSAGES, accessToken);
    } else {
      const sent = await this.walkDelta(sentCursor, accessToken);
      sentCursor = sent.newCursor;
      // A conversation seen ONLY in Sent Items is the user's own outbound mail
      // with no inbox activity this cycle. Flagged as a sent-only candidate so the
      // worker skips it without a fetch when it was never imported (a new email
      // awaiting a reply), while still processing it when it WAS imported (a reply
      // to an existing thread) — which is the whole point of tracking this folder.
      collect(sent.entries, (id) => {
        if (!seen.has(id)) sentOnlyCandidates.add(id);
      });
    }

    return {
      changedThreadIds: Array.from(seen),
      removedMessageIds: Array.from(removed),
      sentOnlyCandidateThreadIds: Array.from(sentOnlyCandidates),
      newCursor: serializeOutlookCursor({ inbox: inbox.newCursor, sent: sentCursor }),
    };
  }

  async listThreadsPage(opts: {
    afterMs: number;
    pageToken?: string | undefined;
    pageSize?: number | undefined;
  }): Promise<{
    threads: Array<{
      id: string;
      unread: boolean;
      latestMessageAt: Date;
      messageLabelIds: string[][];
      messageSenders: string[];
      messageRecipients: string[][];
    }>;
    nextPageToken: string | undefined;
    resultSizeEstimate: number;
  }> {
    const accessToken = await this.refreshAccessToken();

    let url: string;
    if (opts.pageToken) {
      // Graph's nextLink is an absolute URL carrying the original filter/orderby.
      url = opts.pageToken;
    } else {
      const afterSecs = Math.max(1, Math.floor(opts.afterMs / 1000));
      const afterIso = new Date(afterSecs * 1000).toISOString();
      const params = new URLSearchParams({
        $filter: `receivedDateTime ge ${afterIso}`,
        $orderby: "receivedDateTime desc",
        $top: String(opts.pageSize ?? 100),
        $select: "id,conversationId,receivedDateTime,isRead",
      });
      url = `${GRAPH_BASE_URL}${INBOX_MESSAGES}?${params}`;
    }

    const page = await this.graphGet<GraphMessage>(url, accessToken);

    // Group the page's messages into one entry per conversation. A conversation
    // whose messages span a page boundary is deduplicated downstream by the
    // upsert on (emailAccountId, providerThreadId); the resume cursor is the
    // Graph skiptoken, so no message is skipped.
    const byConversation = new Map<string, { unread: boolean; latestMessageAt: Date }>();
    for (const msg of page.value ?? []) {
      const id = msg.conversationId;
      if (!id) continue;
      const at = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(0);
      const existing = byConversation.get(id);
      if (existing) {
        existing.unread = existing.unread || msg.isRead === false;
        if (at > existing.latestMessageAt) existing.latestMessageAt = at;
      } else {
        byConversation.set(id, { unread: msg.isRead === false, latestMessageAt: at });
      }
    }

    const threads = Array.from(byConversation.entries()).map(([id, v]) => ({
      id,
      unread: v.unread,
      latestMessageAt: v.latestMessageAt,
      // Outlook sync is inbox-scoped, so a sent-only thread never reaches here;
      // these stay empty (identity/label sent-only detection simply never fires).
      messageLabelIds: [] as string[][],
      messageSenders: [] as string[],
      messageRecipients: [] as string[][],
    }));

    return {
      threads,
      nextPageToken: page["@odata.nextLink"],
      // Graph does not return a cheap total; the progress bar treats 0 as unknown.
      resultSizeEstimate: 0,
    };
  }

  /**
   * Gmail's trash/spam reconciliation queries have no Outlook analogue: the sync
   * is inbox-folder-scoped, so trash (Deleted Items) and spam (Junk Email)
   * threads are never imported and need no reconciliation. Returns an empty list.
   */
  async listThreadIdsByQuery(_q: string, _maxResults: number): Promise<string[]> {
    return [];
  }

  async listRecentThreadIds(maxResults = 10): Promise<string[]> {
    const accessToken = await this.refreshAccessToken();
    const params = new URLSearchParams({
      $top: String(maxResults),
      $orderby: "receivedDateTime desc",
      $select: "conversationId",
    });
    const page = await this.graphGet<GraphMessage>(
      `${GRAPH_BASE_URL}${INBOX_MESSAGES}?${params}`,
      accessToken,
    );
    const seen = new Set<string>();
    for (const msg of page.value ?? []) {
      if (msg.conversationId) seen.add(msg.conversationId);
    }
    return Array.from(seen).slice(0, maxResults);
  }

  async getThreadSnapshot(conversationId: string): Promise<ThreadSnapshot> {
    const accessToken = await this.refreshAccessToken();
    // Escape single quotes per OData literal rules.
    const literal = conversationId.replace(/'/g, "''");
    const params = new URLSearchParams({
      $filter: `conversationId eq '${literal}'`,
      $select: MESSAGE_SELECT,
      $expand: ATTACHMENT_EXPAND,
      $top: "100",
    });

    // Query the MAILBOX, not the inbox folder, then partition the result locally.
    // Outlook keeps the owner's own replies in Sent Items, so an inbox-scoped
    // query returns only the other party's messages and every Outlook thread the
    // user has replied to is routed, summarised and drafted against half the
    // conversation. Gmail has no such gap (`threads.get` is thread-scoped and
    // returns SENT messages), so this is what brings the two providers level.
    //
    // One request, same as the inbox-scoped query it replaces; the folder ids are
    // resolved once per client instance. The alternative — a second folder-scoped
    // query against sentitems — would double the request count on exactly the path
    // that runs thousands of times during a historical backfill.
    const [folders, raw] = await Promise.all([
      this.snapshotFolderIds(accessToken),
      this.fetchAllPages(`${GRAPH_BASE_URL}${ALL_MESSAGES}?${params}`, accessToken),
    ]);

    // Only the inbox and Sent Items are part of a thread. Everything else the
    // mailbox-wide query can now return is dropped HERE, explicitly, rather than
    // being excluded by the accident of the query's folder scope:
    //   - Drafts        an unsent reply is not part of the conversation and must
    //                   never be persisted, classified, summarised, or treated as
    //                   the message being replied to. Matched on `isDraft` as well
    //                   as on folder, since a draft can be saved outside Drafts.
    //   - Junk Email    spam, excluded like Gmail's SPAM label.
    //   - Deleted Items trash, excluded like Gmail's TRASH label.
    //   - Archive and user-created folders — a message filed out of the inbox is
    //                   a REMOVAL (see below), so it must not reappear here.
    const inbox: GraphMessage[] = [];
    const sent: GraphMessage[] = [];
    for (const msg of raw) {
      if (msg.isDraft === true) continue;
      if (msg.parentFolderId === folders.inbox) inbox.push(msg);
      else if (msg.parentFolderId === folders.sent) sent.push(msg);
    }

    if (inbox.length === 0) {
      // The not-found signal is derived from the INBOX partition alone, exactly as
      // it was when the whole query was inbox-scoped. Graph has no per-conversation
      // 404 on this path: a filter query for a deleted/unknown conversationId
      // succeeds (200) with an empty result set. (A direct GET /me/messages/{id}
      // would 404 with ErrorItemNotFound, but we never fetch that way.) Typed so
      // the sync/classify loops skip exactly this case; a 404 on the query itself
      // means the mailbox/endpoint is broken, stays a generic error, and
      // propagates as transient.
      //
      // Widening the signal to the union would break it: a thread whose inbound
      // messages have all been archived still has its Sent Items copies, and would
      // stop reading as gone.
      if (raw.length > 0 && sent.length === 0 && raw.some((m) => m.isDraft !== true)) {
        // Nothing matched either folder. Expected when the thread has been fully
        // archived; also the shape an id-format mismatch would take, which would
        // silently stop all Outlook imports — so say so once, with counts only.
        console.warn(
          `[graph] conversation matched no inbox/sent folder id (${raw.length} message(s)): ` +
            `thread archived, or folder ids resolved under a different id type`,
        );
      }
      throw new MailThreadNotFoundError(`Graph conversation not found: ${conversationId}`);
    }

    // Message REMOVAL stays inbox-derived too. A message archived, moved to a user
    // folder, or deleted lands in neither partition, so it drops out of the
    // snapshot and the sync job's stored-vs-snapshot diff deletes its row — the
    // behaviour that a naive mailbox-wide query would have destroyed. The owner's
    // sent copies are in the retained set, so persisting them does not make them
    // look like removals on the next sync.
    return normalizeGraphThread([...inbox, ...sent], conversationId);
  }

  /**
   * Fetch the raw bytes of one attachment, used to serve CID inline images.
   * Graph returns a single `fileAttachment` with base64 `contentBytes` plus its
   * `contentType`. An item/reference attachment (no `contentBytes`) throws, as
   * does any non-OK status — the image-proxy route degrades either to a hidden
   * image. Never logs the payload.
   */
  async getAttachmentContent(
    providerMessageId: string,
    attachmentId: string,
  ): Promise<{ data: Uint8Array; mimeType: string | null; size: number }> {
    const accessToken = await this.refreshAccessToken();
    const url =
      `${GRAPH_BASE_URL}/me/messages/${encodeURIComponent(providerMessageId)}` +
      `/attachments/${encodeURIComponent(attachmentId)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'IdType="ImmutableId"',
      },
    });
    if (res.status === 401) {
      const detail = await describeGraphError(res);
      throw new MailAuthError(`Graph request failed: 401${detail ? ` — ${detail}` : ""}`);
    }
    if (!res.ok) throw new Error(`Graph attachment fetch failed: ${res.status}`);
    const json = (await res.json()) as {
      contentBytes?: string;
      contentType?: string | null;
      size?: number;
    };
    if (!json.contentBytes) throw new Error("Graph attachment had no contentBytes");
    const data = new Uint8Array(Buffer.from(json.contentBytes, "base64"));
    return { data, mimeType: json.contentType ?? null, size: json.size ?? data.byteLength };
  }

  /**
   * Registers a Graph change-notification subscription for the inbox. `target` is
   * the public HTTPS webhook URL. Graph performs a validation handshake against
   * `target` during creation, so this requires the webhook receiver to be live
   * (Phase C). Max lifetime for mail is ~4230 minutes; the worker renews before
   * expiry. Returns the subscription id as the cursor and its expiry (unix ms).
   */
  async registerWatch(target: string): Promise<{ cursor: string; expiresAt: string }> {
    const accessToken = await this.refreshAccessToken();
    // 4230 min is the documented mail maximum; back off slightly for clock skew.
    const expiration = new Date(Date.now() + 4200 * 60 * 1000).toISOString();
    const res = await fetch(`${GRAPH_BASE_URL}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // `deleted` covers a message leaving the inbox (archive / delete / move
        // out): Graph reports it as a delete from the subscribed folder. Without
        // it the webhook never fires on a removal, so the thread would re-sort
        // late (only on the next unrelated sync) — diverging from Gmail, whose
        // INBOX watch fires the moment a message loses the INBOX label.
        changeType: "created,updated,deleted",
        notificationUrl: target,
        resource: "/me/mailFolders('inbox')/messages",
        expirationDateTime: expiration,
        clientState: process.env["MS_GRAPH_SUBSCRIPTION_SECRET"] ?? "",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph subscription create failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id: string; expirationDateTime: string };
    return {
      cursor: data.id,
      expiresAt: String(new Date(data.expirationDateTime).getTime()),
    };
  }

  /**
   * Removes this user's mail subscriptions. Graph has no mailbox-wide stop, and
   * we do not thread the subscription id here, so we list the token's
   * subscriptions and delete each. Best-effort; must run before token revoke.
   */
  async stopWatch(): Promise<void> {
    const accessToken = await this.refreshAccessToken();
    const list = await this.graphGet<{ id: string }>(`${GRAPH_BASE_URL}/subscriptions`, accessToken);
    for (const sub of list.value ?? []) {
      await fetch(`${GRAPH_BASE_URL}/subscriptions/${encodeURIComponent(sub.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  }

  // ── Opt-in folder→category writeback (Mail.ReadWrite) ───────────────────────

  /**
   * Idempotently ensure a master category exists for each folder def and return
   * nodeId → category display name (the identifier used on messages). Outlook
   * categories are FLAT, so the full path is encoded as a single literal display
   * name ("Aziru/Clients/Acme") — only the leaf category is created, no
   * ancestors. Matching is case-insensitive (Outlook treats category names so).
   * The palette key maps to an Outlook preset color. Never deletes or renames.
   */
  async ensureFolderLabels(
    defs: Array<{ nodeId: string; pathSegments: string[]; colorKey: string }>,
  ): Promise<Map<string, string>> {
    const accessToken = await this.refreshAccessToken();

    // Existing categories, lowercased display name → canonical display name.
    const existing = new Map<string, string>();
    let url: string | undefined = `${GRAPH_BASE_URL}/me/outlook/masterCategories`;
    while (url) {
      const page: GraphListResponse<{ displayName: string }> = await this.graphGet<{
        displayName: string;
      }>(url, accessToken);
      for (const cat of page.value ?? []) existing.set(cat.displayName.toLowerCase(), cat.displayName);
      url = page["@odata.nextLink"];
    }

    const result = new Map<string, string>();
    for (const def of defs) {
      if (def.pathSegments.length === 0) continue;
      const displayName = def.pathSegments.join("/");
      const key = displayName.toLowerCase();

      if (existing.has(key)) {
        result.set(def.nodeId, existing.get(key)!);
        continue;
      }

      const color = OUTLOOK_PRESET_COLORS[def.colorKey] ?? "preset0";
      const res = await this.graphSend(
        "POST",
        `${GRAPH_BASE_URL}/me/outlook/masterCategories`,
        accessToken,
        { displayName, color },
      );
      // 409 (or any "already exists"): another run created it — treat as present.
      if (res.status === 409) {
        existing.set(key, displayName);
      } else if (!res.ok) {
        throw new Error(`Graph masterCategory create failed: ${res.status} ${await res.text().catch(() => "")}`);
      } else {
        existing.set(key, displayName);
      }
      result.set(def.nodeId, displayName);
    }

    return result;
  }

  /**
   * Reconcile the Aziru-managed categories on a thread's messages to exactly
   * `desiredLabelIds` (of the `managedLabelIds` set), preserving any categories
   * the user set themselves. Outlook applies categories PER MESSAGE, and PATCH
   * replaces the whole array, so this reads-modifies-writes each message and
   * skips those already correct (no write = no delta-sync churn). A 404 on one
   * message (moved/deleted) is skipped; the rest proceed.
   */
  async applyThreadFolderLabels(opts: {
    threadId: string;
    messageIds: string[];
    desiredLabelIds: string[];
    managedLabelIds: string[];
  }): Promise<void> {
    const accessToken = await this.refreshAccessToken();
    const managedLower = new Set(opts.managedLabelIds.map((c) => c.toLowerCase()));
    const desired = opts.desiredLabelIds;

    for (const messageId of opts.messageIds) {
      const getRes = await this.graphSend(
        "GET",
        `${GRAPH_BASE_URL}/me/messages/${encodeURIComponent(messageId)}?$select=categories`,
        accessToken,
      );
      if (getRes.status === 404) continue; // message gone — skip, continue others
      if (!getRes.ok) throw new Error(`Graph message categories fetch failed: ${getRes.status}`);
      const current = ((await getRes.json()) as { categories?: string[] }).categories ?? [];

      // Keep the user's own (unmanaged) categories, then add the desired ones.
      const kept = current.filter((c) => !managedLower.has(c.toLowerCase()));
      const nextSet = new Map<string, string>();
      for (const c of kept) nextSet.set(c.toLowerCase(), c);
      for (const c of desired) nextSet.set(c.toLowerCase(), c);
      const next = [...nextSet.values()];

      // No change → skip the PATCH (idempotent, avoids self-triggered churn).
      const sameLength = next.length === current.length;
      const sameMembers = current.every((c) => nextSet.has(c.toLowerCase()));
      if (sameLength && sameMembers) continue;

      const patchRes = await this.graphSend(
        "PATCH",
        `${GRAPH_BASE_URL}/me/messages/${encodeURIComponent(messageId)}`,
        accessToken,
        { categories: next },
      );
      if (patchRes.status === 404) continue;
      if (!patchRes.ok) throw new Error(`Graph message categories patch failed: ${patchRes.status}`);
    }
  }

  /**
   * Authenticated POST/PATCH/GET against an absolute Graph URL, mirroring
   * graphGet's 429 Retry-After and 401→MailAuthError handling, but returning the
   * raw Response so callers can branch on 404/409. Sets Prefer: ImmutableId so a
   * message id used here matches the one captured at sync time.
   */
  private async graphSend(
    method: "GET" | "POST" | "PATCH",
    url: string,
    accessToken: string,
    body?: unknown,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'IdType="ImmutableId"',
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 1;
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
        continue;
      }
      if (res.status === 401) {
        const detail = await describeGraphError(res);
        throw new MailAuthError(`Graph request failed: 401${detail ? ` — ${detail}` : ""}`);
      }
      return res;
    }
    throw new Error("Graph request failed after retry");
  }
}

// Palette key → Outlook preset category color. Outlook exposes a fixed preset
// palette (preset0..preset24); these are the nearest presets to the shared
// 8-key folder palette (chosen from the Gmail∩Outlook intersection).
// VERIFY the pink→preset9 (Cranberry) and teal→preset5 choices visually.
const OUTLOOK_PRESET_COLORS: Record<string, string> = {
  red: "preset0", // Red
  orange: "preset1", // Orange
  yellow: "preset3", // Yellow
  green: "preset4", // Green
  teal: "preset5", // Teal
  blue: "preset7", // Blue
  purple: "preset8", // Purple
  pink: "preset9", // Cranberry (closest to pink)
};
