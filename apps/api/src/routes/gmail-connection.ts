import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import {
  parseGrantedScopes,
  exchangeAuthCode,
  exchangeServerAuthCode,
  GmailApiError,
} from "@amarnai/gmail";
import { storeGmailConnection } from "@amarnai/auth";
import type { AppEnv } from "../env.js";
import { disconnectGmail } from "../services/gmail-disconnect.js";
import { registerGmailWatch } from "../services/gmail-watch.js";
import {
  buildConnectionResponse,
  runProviderConnect,
} from "../services/provider-connect.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const gmailConnection = new Hono<AppEnv>();

gmailConnection.get("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const workspace = await db.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  // buildConnectionResponse omits encryptedRefreshToken (not in the select) and
  // maps the neutral emailAddress column to the `gmailAddress` client key. Returns
  // null when the workspace has no connection.
  const connection = await buildConnectionResponse(parsed.data.workspaceId, c.get("userId"));
  return c.json(connection, 200);
});

// One-time auth code from a Google Sign-In. Mobile sends a serverAuthCode minted
// against the Web client directly (no redirect). The browser extension runs the
// code flow via chrome.identity and sends the chromiumapp.org redirectUri its
// code was minted for — the code must be redeemed against that exact redirect.
const connectBody = z.object({
  serverAuthCode: z.string().min(1),
  scope: z.string().min(1),
  redirectUri: z.string().min(1).optional(),
});

// Connect or reconnect Gmail for an existing workspace. Owner-only.
// The mobile app obtains a serverAuthCode; the API redeems it with the Web client.
gmailConnection.post("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;
  const userId = c.get("userId");
  // Owner-only is enforced at the mount (requireWorkspaceOwner in app.ts).

  const body = await c.req.json().catch(() => null);
  const bodyParsed = connectBody.safeParse(body);
  if (!bodyParsed.success) return c.json({ error: "Invalid request" }, 400);

  const { serverAuthCode, scope, redirectUri } = bodyParsed.data;
  const notGranted = "Gmail read access was not granted";
  // Early check on the client-claimed scope; the authoritative check inside
  // runProviderConnect is on the scope Google returns from the exchange.
  if (!parseGrantedScopes(scope).hasReadonly) {
    return c.json({ error: notGranted }, 403);
  }

  return runProviderConnect({
    c,
    workspaceId,
    userId,
    // Redeem the code with the confidential Web client. Extension codes carry the
    // chromiumapp.org redirect they were minted for; mobile server-auth codes have
    // none (redeemed against the webClientId directly). Mirrors /auth/google.
    exchange: () =>
      redirectUri
        ? exchangeAuthCode(serverAuthCode, redirectUri)
        : exchangeServerAuthCode(serverAuthCode),
    parseScopes: parseGrantedScopes,
    store: async (a) => ({ emailAddress: (await storeGmailConnection(a)).gmailAddress }),
    isApiError: (err) => err instanceof GmailApiError,
    audit: {
      eventType: "gmail.connected",
      entityType: "GmailConnection",
      addressKey: "gmailAddress",
    },
    registerPush: registerGmailWatch,
    fireExtensionNudge: true,
    logPrefix: "gmail-connection/connect",
    messages: {
      notGranted,
      mismatch: "This workspace is connected to a different mail provider",
      apiError: "Could not verify Gmail access",
      storeError: "Could not store Gmail connection",
    },
  });
});

gmailConnection.delete("/workspaces/:workspaceId/gmail-connection", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const existing = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: { id: true },
  });
  if (!existing) return c.json({ error: "No Gmail connection found" }, 404);

  const eraseData = c.req.query("eraseData") === "true";
  const actorUserId = c.get("userId");

  const result = await disconnectGmail(workspaceId, { eraseData, actorUserId });
  return c.json(result);
});

export { gmailConnection as gmailConnectionRoute };
