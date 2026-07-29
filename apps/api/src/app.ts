import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "@amarnai/config";
import { db } from "@amarnai/db";
import { verifyAccessToken, StaleWhileErrorCache } from "@amarnai/auth";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.js";
import { rateLimit } from "./services/rate-limit.js";
import { constantTimeEqual } from "./services/constant-time-equal.js";
import { isTaxonomyEditor } from "./services/taxonomy-permission.js";
import { healthRoute } from "./routes/health.js";
import { authRoute } from "./routes/auth.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { taxonomyNodesRoute } from "./routes/taxonomy-nodes.js";
import { taxonomyEdgesRoute } from "./routes/taxonomy-edges.js";
import { taxonomyImportRoute } from "./routes/taxonomy-import.js";
import { taxonomyGenerateRoute } from "./routes/taxonomy-generate.js";
import { tagsRoute } from "./routes/tags.js";
import { emailThreadsRoute } from "./routes/email-threads.js";
import { mockInboxRoute } from "./routes/mock-inbox.js";
import { classifyRoute } from "./routes/classify.js";
import { gmailConnectionRoute } from "./routes/gmail-connection.js";
import { outlookConnectionRoute } from "./routes/outlook-connection.js";
import { gmailSyncSettingsRoute } from "./routes/gmail-sync-settings.js";
import { gmailSortRoute } from "./routes/gmail-sort.js";
import { triggerSyncRoute } from "./routes/trigger-sync.js";
import { sweepInboxRoute } from "./routes/sweep-inbox.js";
import { syncStatusRoute } from "./routes/sync-status.js";
import { triageRoute } from "./routes/triage.js";
import { folderCountsRoute } from "./routes/folder-counts.js";
import { sortingQueueRoute } from "./routes/sorting-queue.js";
import { draftsRoute } from "./routes/drafts.js";
import { threadSummaryRoute } from "./routes/thread-summary.js";
import { providerThreadsRoute } from "./routes/provider-threads.js";
import { panelQueueRoute } from "./routes/panel-queue.js";
import { mailAccountsRoute } from "./routes/mail-accounts.js";
import { resolveThreadRoute } from "./routes/resolve-thread.js";
import { assignThreadRoute } from "./routes/assign-thread.js";
import { threadImportantRoute } from "./routes/thread-important.js";
import { notificationsRoute } from "./routes/notifications.js";
import { gmailWebhookRoute } from "./routes/gmail-webhook.js";
import { gmailWatchRoute } from "./routes/gmail-watch.js";
import { outlookWebhookRoute } from "./routes/outlook-webhook.js";
import { outlookSubscriptionRoute } from "./routes/outlook-subscription.js";
import { workspaceEventsRoute } from "./routes/workspace-events.js";
import { devicesRoute } from "./routes/devices.js";
import { extensionRoute } from "./routes/extension.js";
import { adminRoute } from "./routes/admin.js";

// Endpoints that authenticate themselves and must skip the bearer-token check.
// An explicit allowlist (not an "/auth/" prefix match) so a future /auth/* route
// cannot accidentally become public.
const PUBLIC_PATHS = new Set([
  "/health",
  "/webhooks/gmail",
  "/webhooks/outlook",
  "/auth/login",
  "/auth/register",
  "/auth/google",
  "/auth/microsoft",
  "/auth/refresh",
  "/auth/logout",
  "/auth/forgot-password",
]);

// Short-TTL cache for the per-user access-token epoch check below. Keyed by user
// id; value is the account row (or null when the account is gone — a real,
// enforced value). Keeps the check off a blocking DB read on every native call
// and keeps a DB blip from 500ing every bearer request. See StaleWhileErrorCache.
const sessionEpochCache = new StaleWhileErrorCache<{ sessionEpoch: number } | null>();

const app = new Hono<AppEnv>();

// CORS: allow the configured web origin plus the browser extension. The
// extension calls the API from an extension origin whose id differs between the
// unpacked dev build and the re-signed store build, so we match the scheme
// rather than a fixed id: chrome-extension:// (Chrome side panel + service
// worker) and moz-extension:// (Firefox sidebar + event page). Auth is by bearer
// token in the Authorization header (no cookies), so CORS is not the security
// boundary here; the per-route token check is.
const WEB_ORIGIN = process.env["CORS_ORIGIN"] ?? "http://localhost:3000";
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (origin === WEB_ORIGIN) return origin;
      if (origin.startsWith("chrome-extension://")) return origin;
      if (origin.startsWith("moz-extension://")) return origin;
      return null;
    },
  }),
);

// Per-IP rate limiting on the public auth endpoints (the only token-less surface).
// Login is the tightest since it is the password brute-force target; refresh is
// looser because legitimate clients refresh periodically.
app.use("/auth/login", rateLimit({ limit: 10, windowSeconds: 900, prefix: "login" }));
app.use("/auth/register", rateLimit({ limit: 5, windowSeconds: 900, prefix: "register" }));
app.use("/auth/google", rateLimit({ limit: 20, windowSeconds: 900, prefix: "google" }));
app.use("/auth/microsoft", rateLimit({ limit: 20, windowSeconds: 900, prefix: "microsoft" }));
app.use("/auth/refresh", rateLimit({ limit: 60, windowSeconds: 900, prefix: "refresh" }));
app.use("/auth/forgot-password", rateLimit({ limit: 5, windowSeconds: 900, prefix: "forgot-password" }));

app.use("*", async (c, next) => {
  // Public endpoints that authenticate themselves (health check, Gmail Pub/Sub
  // webhook, and the token-minting /auth endpoints).
  if (PUBLIC_PATHS.has(c.req.path)) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  // Path 1 — trusted service-to-service caller (web SSR, worker): the shared
  // internal secret plus an X-User-Id header it is trusted to set.
  const secret = config.internalApiSecret;
  if (constantTimeEqual(token, secret)) {
    const headerUserId = c.req.header("X-User-Id");
    if (headerUserId) c.set("userId", headerUserId);
    return next();
  }

  // Path 2 — per-user access token (native clients). The user id is taken from
  // the verified token; any caller-supplied X-User-Id header is ignored. The
  // token carries the session epoch it was minted at; reject it if the account's
  // epoch has since advanced (password reset / pre-hijack invalidation) or the
  // account is gone, so a revoked session cannot outlive its access-token TTL.
  const verified = await verifyAccessToken(token);
  if (verified) {
    // Enforce the session epoch through a short-TTL cache: not a blocking DB read
    // on every native call, and a transient DB error degrades instead of 500ing
    // every bearer request. "stale" still enforces a revocation seen before the
    // outage; "unavailable" (DB down AND user never cached here) is the only
    // fail-open case and lasts only as long as the outage.
    const outcome = await sessionEpochCache.get(verified.userId, () =>
      db.user.findUnique({
        where: { id: verified.userId },
        select: { sessionEpoch: true },
      }),
    );
    if (outcome.status === "unavailable") {
      console.error("[auth] epoch check unavailable, failing open for:", verified.userId);
    } else {
      const user = outcome.value;
      if (!user || verified.sessionEpoch < user.sessionEpoch) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    c.set("userId", verified.userId);
    return next();
  }

  return c.json({ error: "Unauthorized" }, 401);
});

// Workspace membership guard: rejects requests where the authenticated user
// is not a member of the workspace in the URL. Returns 404 to avoid leaking
// whether the workspace exists to non-members.
const requireWorkspaceMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  // workspaceId is guaranteed by the /workspaces/:workspaceId/* middleware path.
  const workspaceId = c.req.param("workspaceId") as string;
  const userId: string = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { userId: true },
  });
  if (!member) return c.json({ error: "Workspace not found" }, 404);

  return next();
};

// Workspace-owner guard: rejects members who are not the workspace owner. Runs
// after requireWorkspaceMember (owners are always members), so a non-member is
// already 404'd here and only a non-owner member reaches the 403. Reuses the
// { id, ownerUserId } lookup that the connection connect handlers used inline.
const requireWorkspaceOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const workspaceId = c.req.param("workspaceId") as string;
  const userId: string = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  // Authorization reads the membership role, the same field every other
  // owner-only path checks (workspace update, billing, taxonomy permissions).
  // Workspace.ownerUserId is a separate column that answers a different
  // question — whose quota this counts against and what cascades on delete —
  // and using it here made "owner" mean two things in one service.
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (member?.role !== "OWNER") return c.json({ error: "Not authorized" }, 403);

  return next();
};

// Taxonomy-editor guard: rejects members who may not edit the taxonomy. OWNERs
// always pass; MEMBERs pass only when the workspace has membersCanEditTaxonomy
// enabled (isTaxonomyEditor). Applied to every taxonomy mutation so a new write
// route inherits the check instead of re-implementing it per handler.
const requireTaxonomyEditor: MiddlewareHandler<AppEnv> = async (c, next) => {
  const workspaceId = c.req.param("workspaceId") as string;
  const userId: string = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  if (!(await isTaxonomyEditor(workspaceId, userId))) {
    return c.json({ error: "Taxonomy editing is restricted to workspace admins" }, 403);
  }

  return next();
};

app.use("/workspaces/:workspaceId/*", requireWorkspaceMember);
app.use("/dev/workspaces/:workspaceId/*", requireWorkspaceMember);

// Owner-only: connecting or disconnecting a mailbox is destructive (a member
// could otherwise disconnect with ?eraseData=true and wipe the mailbox). Both
// providers share the single disconnect route — DELETE gmail-connection tears
// down OUTLOOK rows too (disconnectGmail is provider-neutral) — so Outlook needs
// no separate delete guard; its only mutating route is the connect POST.
app.on(["POST", "DELETE"], "/workspaces/:workspaceId/gmail-connection", requireWorkspaceOwner);
app.on("POST", "/workspaces/:workspaceId/outlook-connection", requireWorkspaceOwner);

// Taxonomy-editor: every mutating taxonomy route. GETs stay on membership.
app.on(
  ["POST", "PATCH", "DELETE"],
  [
    "/workspaces/:workspaceId/taxonomy-nodes",
    "/workspaces/:workspaceId/taxonomy-nodes/:nodeId",
    "/workspaces/:workspaceId/taxonomy-edges",
    "/workspaces/:workspaceId/taxonomy-edges/:edgeId",
  ],
  requireTaxonomyEditor,
);
app.on(
  "POST",
  [
    "/workspaces/:workspaceId/taxonomy-import",
    "/workspaces/:workspaceId/taxonomy-import/preview",
    "/workspaces/:workspaceId/taxonomy-generate",
  ],
  requireTaxonomyEditor,
);

app.route("/", healthRoute);
app.route("/", authRoute);
app.route("/", workspacesRoute);
app.route("/", taxonomyNodesRoute);
app.route("/", taxonomyEdgesRoute);
app.route("/", taxonomyImportRoute);
app.route("/", taxonomyGenerateRoute);
app.route("/", tagsRoute);
app.route("/", emailThreadsRoute);
app.route("/", mockInboxRoute);
app.route("/", classifyRoute);
app.route("/", gmailConnectionRoute);
app.route("/", outlookConnectionRoute);
app.route("/", gmailSyncSettingsRoute);
app.route("/", gmailSortRoute);
app.route("/", triggerSyncRoute);
app.route("/", sweepInboxRoute);
app.route("/", syncStatusRoute);
app.route("/", triageRoute);
app.route("/", folderCountsRoute);
app.route("/", sortingQueueRoute);
app.route("/", draftsRoute);
app.route("/", threadSummaryRoute);
app.route("/", providerThreadsRoute);
app.route("/", panelQueueRoute);
app.route("/", resolveThreadRoute);
app.route("/", assignThreadRoute);
app.route("/", threadImportantRoute);
// User-scoped (not under the /workspaces/:workspaceId/* membership guard):
// tenancy is enforced inside the route by filtering on the authenticated user.
app.route("/", notificationsRoute);
app.route("/", mailAccountsRoute);
app.route("/", gmailWebhookRoute);
app.route("/", gmailWatchRoute);
app.route("/", outlookWebhookRoute);
app.route("/", outlookSubscriptionRoute);
app.route("/", workspaceEventsRoute);
app.route("/", devicesRoute);
app.route("/", extensionRoute);
app.route("/", adminRoute);

// Safety net: any uncaught error in a handler or middleware becomes a JSON 500
// rather than an unhandled rejection / crashed request. The client never sees the
// error text and no request body is logged (email contents are sensitive). The
// epoch check above no longer throws on a DB blip; this covers every other route.
app.onError((err, c) => {
  console.error("[api] unhandled error:", err instanceof Error ? err.message : err);
  return c.json({ error: "Internal server error" }, 500);
});

// Exported so tests can isolate the module-singleton cache between cases.
export { sessionEpochCache };

export default app;
