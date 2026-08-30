import { Hono } from "hono";
import { z } from "zod";
import { config } from "@aziru/config";
import {
  parseGrantedScopes,
  exchangeAuthCode,
  scopeForCodeRedemption,
  MicrosoftApiError,
} from "@aziru/outlook";
import { storeOutlookConnection } from "@aziru/auth";
import type { AppEnv } from "../env.js";
import { registerOutlookSubscription } from "../services/outlook-subscription.js";
import { runProviderConnect } from "../services/provider-connect.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

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
  // Owner-only is enforced at the mount (requireWorkspaceOwner in app.ts).

  const body = await c.req.json().catch(() => null);
  const bodyParsed = connectBody.safeParse(body);
  if (!bodyParsed.success) return c.json({ error: "Invalid request" }, 400);

  const { code, scope, redirectUri } = bodyParsed.data;
  const notGranted = "Outlook read access (Mail.Read) was not granted";
  // Early check on the client-claimed scope; the authoritative check inside
  // runProviderConnect is on the scope Microsoft returns from the exchange.
  if (!parseGrantedScopes(scope).hasReadonly) {
    return c.json({ error: notGranted }, 403);
  }

  return runProviderConnect({
    c,
    workspaceId,
    userId,
    // Redeem the code against the extension's chromiumapp.org redirect with the
    // confidential Web client (no PKCE — the redirect is registered on the app).
    // Redeem against the scope set the extension actually consented to — an
    // older build that predates the `openid` sign-in scope must not be sent a
    // wider redemption than its authorize request (Microsoft rejects those).
    exchange: () => exchangeAuthCode(code, redirectUri, undefined, scopeForCodeRedemption(scope)),
    parseScopes: parseGrantedScopes,
    store: storeOutlookConnection,
    isApiError: (err) => err instanceof MicrosoftApiError,
    audit: {
      eventType: "outlook.connected",
      entityType: "EmailConnection",
      addressKey: "emailAddress",
    },
    registerPush: registerOutlookSubscription,
    // Outlook does not fire the extension-install nudge (Gmail-only path).
    fireExtensionNudge: false,
    logPrefix: "outlook-connection/connect",
    messages: {
      notGranted,
      mismatch: "This workspace is connected to a different mail provider",
      apiError: "Could not verify Outlook access",
      storeError: "Could not store Outlook connection",
    },
  });
});

export { outlookConnection as outlookConnectionRoute };
