import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { config } from "@amarnai/config";
import { parseGrantedScopes, exchangeAuthCode, MicrosoftApiError } from "@amarnai/outlook";
import { storeOutlookConnection, ProviderMismatchError } from "@amarnai/auth";
import type { AppEnv } from "../env.js";
import {
  countActiveSiblingConnections,
  listVisibleSiblingConnections,
} from "../services/gmail-disconnect.js";
import { syncInboxQueue } from "../services/queue-client.js";
import { registerOutlookSubscription } from "../services/outlook-subscription.js";
import { recordAudit } from "../services/audit.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

// Same shape the GET/POST Gmail endpoint returns (see gmail-connection.ts). The
// neutral `emailAddress` column is mapped to the `gmailAddress` client key.
const connectionSelect = {
  id: true,
  workspaceId: true,
  provider: true,
  emailAddress: true,
  grantedScopes: true,
  status: true,
  lastVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// The browser extension runs the Microsoft code flow via chrome.identity and
// sends the authorization code plus the chromiumapp.org redirect it was minted
// for. The code is redeemed against that exact redirect with the confidential
// Web client (mirrors the Gmail extension path in gmail-connection.ts).
const connectBody = z.object({
  code: z.string().min(1),
  scope: z.string().min(1),
  redirectUri: z.string().min(1),
});

const outlookConnection = new Hono<AppEnv>();

// Connect or reconnect Outlook for an existing workspace. Owner-only. Mirrors
// POST /workspaces/:id/gmail-connection but for Microsoft Graph.
outlookConnection.post("/workspaces/:workspaceId/outlook-connection", async (c) => {
  if (!config.outlook.enabled) {
    return c.json({ error: "Outlook is not configured" }, 404);
  }

  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;
  const userId = c.get("userId");

  // Only the workspace owner may connect a mailbox (mirrors the web connect flow).
  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, ownerUserId: userId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Not authorized" }, 403);

  const body = await c.req.json().catch(() => null);
  const bodyParsed = connectBody.safeParse(body);
  if (!bodyParsed.success) return c.json({ error: "Invalid request" }, 400);

  const { code, scope, redirectUri } = bodyParsed.data;
  // Early check on the client-claimed scope; the authoritative check is on the
  // scope Microsoft returns from the exchange below.
  if (!parseGrantedScopes(scope).hasReadonly) {
    return c.json({ error: "Outlook read access (Mail.Read) was not granted" }, 403);
  }

  // Prior inbox on this workspace (if any) so the audit below can flag a rotation.
  const priorConnection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, status: true },
  });

  let emailAddress: string;
  try {
    // Redeem the code against the extension's chromiumapp.org redirect with the
    // confidential Web client (no PKCE — the redirect is registered on the app).
    const tokens = await exchangeAuthCode(code, redirectUri);
    const { scopes: grantedScopes, hasReadonly } = parseGrantedScopes(tokens.scope);
    if (!hasReadonly) {
      return c.json({ error: "Outlook read access (Mail.Read) was not granted" }, 403);
    }
    const stored = await storeOutlookConnection({
      workspaceId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      grantedScopes,
    });
    emailAddress = stored.emailAddress;

    // Audit the connect (best-effort). `replacedAddress` is set only when a
    // DIFFERENT inbox was connected before — the rotation signal.
    const replacedAddress =
      priorConnection?.emailAddress && priorConnection.emailAddress !== emailAddress
        ? priorConnection.emailAddress
        : null;
    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: "outlook.connected",
      entityType: "EmailConnection",
      metadata: { emailAddress, replacedAddress, priorStatus: priorConnection?.status ?? null },
    });
  } catch (err) {
    if (err instanceof ProviderMismatchError) {
      // This workspace's inbox belongs to a different provider (e.g. Gmail).
      return c.json(
        { error: "This workspace is connected to a different mail provider" },
        409,
      );
    }
    if (err instanceof MicrosoftApiError) {
      // Code redemption or profile verification failed (expired/reused/invalid).
      return c.json({ error: "Could not verify Outlook access" }, 502);
    }
    console.error("[outlook-connection/connect] store:", err instanceof Error ? err.message : err);
    return c.json({ error: "Could not store Outlook connection" }, 500);
  }

  // Fire-and-forget: immediate inbox sync. Same dedup id as the Gmail path so a
  // concurrent call does not double-queue.
  syncInboxQueue
    .add("sync-inbox", { workspaceId }, { deduplication: { id: `sync-inbox_${workspaceId}` } })
    .catch((err) =>
      console.error(
        "[outlook-connection/connect] trigger_sync:",
        err instanceof Error ? err.message : err,
      ),
    );

  // Fire-and-forget: arm the Graph change subscription immediately (mirrors the
  // Gmail watch). The worker's periodic renewal is the fallback.
  registerOutlookSubscription(workspaceId).catch((err) =>
    console.error(
      "[outlook-connection/connect] register_subscription:",
      err instanceof Error ? err.message : err,
    ),
  );

  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: connectionSelect,
  });
  if (!connection) return c.json({ error: "Connection not found" }, 500);

  const { emailAddress: addr, ...rest } = connection;
  const [siblingsCount, alsoConnectedIn] = await Promise.all([
    countActiveSiblingConnections(addr, connection.workspaceId),
    listVisibleSiblingConnections(addr, connection.workspaceId, userId),
  ]);

  return c.json(
    { ...rest, gmailAddress: addr, sharedMailbox: siblingsCount > 0, alsoConnectedIn },
    201,
  );
});

export { outlookConnection as outlookConnectionRoute };
