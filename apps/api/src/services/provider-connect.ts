import type { Context } from "hono";
import { db, maybeCreateExtensionNudge } from "@aziru/db";
import { ProviderMismatchError } from "@aziru/auth";
import type { AppEnv } from "../env.js";
import {
  countActiveSiblingConnections,
  listVisibleSiblingConnections,
} from "./gmail-disconnect.js";
import { syncInboxQueue } from "./queue-client.js";
import { enableLabelWritebackForGrant } from "./label-writeback.js";
import { recordAudit } from "./audit.js";

// Columns returned by the connection GET/POST endpoints. encryptedRefreshToken is
// deliberately absent and must never be added here — it must never reach a client.
export const connectionSelect = {
  id: true,
  workspaceId: true,
  provider: true,
  emailAddress: true,
  // Personal vs work/school for Outlook; clients need it to open the right
  // Outlook-on-the-web host (the work host refuses personal accounts).
  outlookAccountType: true,
  grantedScopes: true,
  status: true,
  lastVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Load the workspace's connection and shape it into the public response body:
 * the neutral `emailAddress` column mapped to the `gmailAddress` client key, plus
 * the cross-tenant `sharedMailbox` flag and the membership-scoped
 * `alsoConnectedIn` list. Returns null when the workspace has no connection.
 *
 * Shared by the Gmail GET/POST and Outlook POST endpoints so the response shape
 * (and the encryptedRefreshToken exclusion) stays identical across them.
 */
export async function buildConnectionResponse(workspaceId: string, userId: string) {
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: connectionSelect,
  });
  if (!connection) return null;

  // encryptedRefreshToken is excluded by connectionSelect and must never be
  // returned. Strip it defensively anyway so it can never leak even if the select
  // is later widened.
  const { emailAddress, ...safe } = connection as typeof connection & {
    encryptedRefreshToken?: unknown;
  };
  delete (safe as { encryptedRefreshToken?: unknown }).encryptedRefreshToken;

  // sharedMailbox is cross-tenant on purpose: it must match the disconnect
  // service's revocation decision. alsoConnectedIn is scoped to the requesting
  // user's memberships — other tenants' workspace names must never leak.
  const [siblingsCount, alsoConnectedIn] = await Promise.all([
    countActiveSiblingConnections(emailAddress, connection.workspaceId),
    listVisibleSiblingConnections(emailAddress, connection.workspaceId, userId),
  ]);

  return {
    ...safe,
    gmailAddress: emailAddress,
    sharedMailbox: siblingsCount > 0,
    alsoConnectedIn,
  };
}

type ProviderTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  /** Outlook only: personal (MSA) vs work/school, from the id_token. */
  accountType?: "PERSONAL" | "ORGANIZATION" | null;
};

export type RunProviderConnectArgs = {
  c: Context<AppEnv>;
  workspaceId: string;
  userId: string;
  /** Redeem the authorization code for tokens (provider- and body-shape-specific). */
  exchange: () => Promise<ProviderTokens>;
  /** Parse the granted scope string; the provider's own read-only check. */
  parseScopes: (scope: string) => { scopes: string[]; hasReadonly: boolean };
  /** Verify the token and persist the connection; returns the connected address. */
  store: (args: {
    workspaceId: string;
    accessToken: string;
    refreshToken: string;
    grantedScopes: string[];
    outlookAccountType?: "PERSONAL" | "ORGANIZATION" | null;
  }) => Promise<{ emailAddress: string }>;
  /** Whether a thrown error is the provider's API error → maps to 502. */
  isApiError: (err: unknown) => boolean;
  audit: { eventType: string; entityType: string; addressKey: string };
  /** Fire-and-forget push registration (Gmail watch / Graph subscription). */
  registerPush: (workspaceId: string) => Promise<unknown>;
  /** Gmail nudges the user to install the extension on connect; Outlook does not. */
  fireExtensionNudge: boolean;
  logPrefix: string;
  messages: { notGranted: string; mismatch: string; apiError: string; storeError: string };
};

/**
 * Shared body of the Gmail and Outlook connect (POST) endpoints. Redeems the
 * code, re-checks read-only scope on the authoritative granted scope, persists
 * the connection, audits the connect (flagging inbox rotation), then fires the
 * immediate sync + push registration and returns the full connection shape.
 *
 * The caller is responsible for the workspace-owner check, body parsing, and the
 * early client-claimed-scope check before invoking this. Provider differences are
 * injected via args so the two endpoints cannot drift apart.
 */
export async function runProviderConnect(args: RunProviderConnectArgs): Promise<Response> {
  const {
    c,
    workspaceId,
    userId,
    exchange,
    parseScopes,
    store,
    isApiError,
    audit,
    registerPush,
    fireExtensionNudge,
    logPrefix,
    messages,
  } = args;

  // Prior inbox on this workspace (if any) so the audit below can flag a ROTATION
  // — connecting a different inbox than was there before.
  const priorConnection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { emailAddress: true, status: true },
  });

  try {
    const { accessToken, refreshToken, scope, accountType } = await exchange();
    const { scopes: grantedScopes, hasReadonly } = parseScopes(scope);
    if (!hasReadonly) return c.json({ error: messages.notGranted }, 403);

    const { emailAddress } = await store({
      workspaceId,
      accessToken,
      refreshToken,
      grantedScopes,
      outlookAccountType: accountType ?? null,
    });

    // Audit the connect (best-effort; never blocks the response). `replacedAddress`
    // is set only when a DIFFERENT inbox was connected before — the rotation signal.
    const replacedAddress =
      priorConnection?.emailAddress && priorConnection.emailAddress !== emailAddress
        ? priorConnection.emailAddress
        : null;
    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: audit.eventType,
      entityType: audit.entityType,
      metadata: {
        [audit.addressKey]: emailAddress,
        replacedAddress,
        priorStatus: priorConnection?.status ?? null,
      },
    });
  } catch (err) {
    if (err instanceof ProviderMismatchError) {
      // This workspace's inbox belongs to a different provider; connecting here
      // would silently clobber it. Reconnect via that provider instead.
      return c.json({ error: messages.mismatch }, 409);
    }
    if (isApiError(err)) {
      // Code redemption or profile verification failed (expired/reused/invalid).
      return c.json({ error: messages.apiError }, 502);
    }
    console.error(`[${logPrefix}] store:`, err instanceof Error ? err.message : err);
    return c.json({ error: messages.storeError }, 500);
  }

  // Fire-and-forget: immediate inbox sync. Same dedup id as /auth/google and
  // trigger-sync so a concurrent call does not double-queue.
  syncInboxQueue
    .add("sync-inbox", { workspaceId }, { deduplication: { id: `sync-inbox_${workspaceId}` } })
    .catch((err) =>
      console.error(`[${logPrefix}] trigger_sync:`, err instanceof Error ? err.message : err),
    );

  // Fire-and-forget: arm push immediately so it is live right after (re)connecting.
  // The worker's periodic renewal is the fallback; polling covers any gap.
  registerPush(workspaceId).catch((err) =>
    console.error(`[${logPrefix}] register_watch:`, err instanceof Error ? err.message : err),
  );

  if (fireExtensionNudge) {
    // One-time "install the browser extension" nudge. No-op if the user already
    // has the extension (they may be connecting *through* it) or was already
    // nudged. Never blocks the connect response.
    maybeCreateExtensionNudge({ userId, workspaceId }).catch((err) =>
      console.error(`[${logPrefix}] extension_nudge:`, err instanceof Error ? err.message : err),
    );
  }

  // The write scope is requested upfront at connect, so this is where writeback
  // gets enabled and folder provisioning starts — the counterpart of what the web
  // OAuth callback does. Here for both providers at once, since both connect
  // routes delegate to this function. Reads the stored scopes, so a read-only
  // connect no-ops, and never throws.
  await enableLabelWritebackForGrant({ workspaceId, source: logPrefix });

  // Return the full connection shape (same as GET) so the client can update state.
  const response = await buildConnectionResponse(workspaceId, userId);
  if (!response) return c.json({ error: "Connection not found" }, 500);
  return c.json(response, 201);
}
