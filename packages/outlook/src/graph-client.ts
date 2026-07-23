import type { ThreadSnapshot } from "@amarnai/ai";
// Neutral control-flow errors are canonical in @amarnai/gmail and re-exported by
// @amarnai/mail as MailAuthError / MailCursorExpiredError. GraphClient throws the
// SAME classes so the worker's `instanceof Mail*Error` branches match, without a
// package cycle (outlook -> gmail only).
import {
  decrypt,
  GmailAuthError as MailAuthError,
  GmailHistoryCursorExpiredError as MailCursorExpiredError,
  GmailThreadNotFoundError as MailThreadNotFoundError,
} from "@amarnai/gmail";
import { normalizeGraphThread, type GraphMessage } from "./normalize-graph-thread.js";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

function tenant(): string {
  return process.env["MS_GRAPH_TENANT"] || "common";
}

function tokenUrl(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
}

// Message fields the classifier snapshot needs. internetMessageHeaders must be
// explicitly selected (it is not returned by default).
const MESSAGE_SELECT =
  "id,conversationId,from,sender,toRecipients,ccRecipients,subject," +
  "receivedDateTime,bodyPreview,uniqueBody,body,hasAttachments,isRead,webLink,internetMessageHeaders";
const ATTACHMENT_EXPAND = "attachments($select=id,name,contentType,size,isInline)";

// The inbox folder is the sync scope: spam (Junk Email) and trash (Deleted Items)
// live in other well-known folders and are therefore never imported, so no
// per-message spam/trash flags are needed downstream.
const INBOX_MESSAGES = "/me/mailFolders/inbox/messages";

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
  constructor(private readonly encryptedRefreshToken: string) {}

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
        scope: "Mail.Read offline_access User.Read",
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
  private async graphGet<T>(url: string, accessToken: string): Promise<GraphListResponse<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'IdType="ImmutableId"',
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
      return (await res.json()) as GraphListResponse<T>;
    }
    // Unreachable in practice: the retry either returns or throws above.
    throw new Error("Graph request failed after retry");
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

    // Establish the initial delta cursor at "now" without importing anything:
    // `$deltatoken=latest` returns a deltaLink representing the current state.
    const initial = await this.graphGet<GraphMessage>(
      `${GRAPH_BASE_URL}${INBOX_MESSAGES}/delta?$deltatoken=latest`,
      accessToken,
    );
    const syncCursor = initial["@odata.deltaLink"] ?? "";
    return { emailAddress, syncCursor };
  }

  async listChangesSince(
    cursor: string,
  ): Promise<{ changedThreadIds: string[]; removedMessageIds: string[]; newCursor: string }> {
    const accessToken = await this.refreshAccessToken();
    const seen = new Set<string>();
    const removed = new Set<string>();
    let url = cursor;
    let newCursor = cursor;

    // Follow nextLink pages until the terminal deltaLink appears.
    for (;;) {
      const page: GraphListResponse<GraphDeltaEntry> = await this.graphGet<GraphDeltaEntry>(
        url,
        accessToken,
      );
      for (const entry of page.value ?? []) {
        // A message archived / deleted / moved out of the inbox surfaces as an
        // `@removed` entry carrying only its id (no conversationId), because the
        // message is gone from the synced folder. Since the inbox is the only
        // scope we track, a move to Archive is indistinguishable from a delete —
        // both are inbox-membership removals. Collect the id so the caller can
        // resolve its thread from persisted data and re-sort it (Gmail parity:
        // an INBOX-label removal re-sorts the whole thread). A normal
        // created/updated entry carries a conversationId and re-sorts its thread
        // directly.
        if (entry["@removed"]) {
          if (entry.id) removed.add(entry.id);
        } else if (entry.conversationId) {
          seen.add(entry.conversationId);
        }
      }
      if (page["@odata.deltaLink"]) {
        newCursor = page["@odata.deltaLink"];
        break;
      }
      if (!page["@odata.nextLink"]) break;
      url = page["@odata.nextLink"];
    }

    return {
      changedThreadIds: Array.from(seen),
      removedMessageIds: Array.from(removed),
      newCursor,
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

    // Scope to the inbox folder, not the whole mailbox. The Outlook adapter is
    // inbox-folder-scoped everywhere else (list + delta), and this keeps the
    // snapshot in step: when a message is archived / deleted / moved out of the
    // inbox it drops out of this result, so a thread that lost one of several
    // messages re-sorts on the reduced set, and a thread whose messages have ALL
    // left the inbox yields an empty set — the definitive not-found signal below.
    // A mailbox-wide `/me/messages` query would still return the archived copies
    // (Archive/Sent live in other folders), so removals would never register.
    const messages: GraphMessage[] = [];
    let next: string | undefined = `${GRAPH_BASE_URL}${INBOX_MESSAGES}?${params}`;
    while (next !== undefined) {
      const page: GraphListResponse<GraphMessage> = await this.graphGet<GraphMessage>(
        next,
        accessToken,
      );
      messages.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }

    if (messages.length === 0) {
      // Graph has no per-conversation 404 on this path: a filter query for a
      // deleted/unknown conversationId (or one no longer present in the inbox)
      // succeeds (200) with an empty result set, so an empty set IS the
      // definitive not-found / gone-from-inbox signal. (A direct
      // GET /me/messages/{id} would 404 with ErrorItemNotFound, but we never
      // fetch that way.) Typed so the sync/classify loops skip exactly this
      // case; a 404 on the query itself means the mailbox/endpoint is broken,
      // stays a generic error, and propagates as transient.
      throw new MailThreadNotFoundError(`Graph conversation not found: ${conversationId}`);
    }

    return normalizeGraphThread(messages, conversationId);
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
}
