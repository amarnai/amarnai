import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "@amarnai/config";
import { db } from "@amarnai/db";
import { verifyAccessToken } from "@amarnai/auth";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.js";
import { rateLimit } from "./services/rate-limit.js";
import { healthRoute } from "./routes/health.js";
import { authRoute } from "./routes/auth.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { taxonomyNodesRoute } from "./routes/taxonomy-nodes.js";
import { taxonomyEdgesRoute } from "./routes/taxonomy-edges.js";
import { taxonomyImportRoute } from "./routes/taxonomy-import.js";
import { tagsRoute } from "./routes/tags.js";
import { emailThreadsRoute } from "./routes/email-threads.js";
import { mockInboxRoute } from "./routes/mock-inbox.js";
import { classifyRoute } from "./routes/classify.js";
import { gmailConnectionRoute } from "./routes/gmail-connection.js";
import { gmailSyncSettingsRoute } from "./routes/gmail-sync-settings.js";
import { gmailSortRoute } from "./routes/gmail-sort.js";
import { triggerSyncRoute } from "./routes/trigger-sync.js";
import { sweepInboxRoute } from "./routes/sweep-inbox.js";
import { syncStatusRoute } from "./routes/sync-status.js";
import { triageRoute } from "./routes/triage.js";
import { folderCountsRoute } from "./routes/folder-counts.js";
import { sortingQueueRoute } from "./routes/sorting-queue.js";
import { draftsRoute } from "./routes/drafts.js";
import { resolveThreadRoute } from "./routes/resolve-thread.js";
import { gmailWebhookRoute } from "./routes/gmail-webhook.js";
import { gmailWatchRoute } from "./routes/gmail-watch.js";
import { workspaceEventsRoute } from "./routes/workspace-events.js";

const app = new Hono<AppEnv>();

app.use("*", cors({ origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000" }));

// Per-IP rate limiting on the public auth endpoints (the only token-less surface).
// Login is the tightest since it is the password brute-force target; refresh is
// looser because legitimate clients refresh periodically.
app.use("/auth/login", rateLimit({ limit: 10, windowSeconds: 900, prefix: "login" }));
app.use("/auth/google", rateLimit({ limit: 20, windowSeconds: 900, prefix: "google" }));
app.use("/auth/refresh", rateLimit({ limit: 60, windowSeconds: 900, prefix: "refresh" }));

app.use("*", async (c, next) => {
  // Public endpoints that authenticate themselves: the health check, the Gmail
  // Pub/Sub webhook, and the /auth/* endpoints (which mint tokens and therefore
  // cannot require one).
  if (
    c.req.path === "/health" ||
    c.req.path === "/webhooks/gmail" ||
    c.req.path.startsWith("/auth/")
  ) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  // Path 1 — trusted service-to-service caller (web SSR, worker): the shared
  // internal secret plus an X-User-Id header it is trusted to set.
  const secret = config.internalApiSecret;
  const tokenBuf = Buffer.from(token, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
    const headerUserId = c.req.header("X-User-Id");
    if (headerUserId) c.set("userId", headerUserId);
    return next();
  }

  // Path 2 — per-user access token (native clients). The user id is taken from
  // the verified token; any caller-supplied X-User-Id header is ignored.
  const tokenUserId = await verifyAccessToken(token);
  if (tokenUserId) {
    c.set("userId", tokenUserId);
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

app.use("/workspaces/:workspaceId/*", requireWorkspaceMember);
app.use("/dev/workspaces/:workspaceId/*", requireWorkspaceMember);

app.route("/", healthRoute);
app.route("/", authRoute);
app.route("/", workspacesRoute);
app.route("/", taxonomyNodesRoute);
app.route("/", taxonomyEdgesRoute);
app.route("/", taxonomyImportRoute);
app.route("/", tagsRoute);
app.route("/", emailThreadsRoute);
app.route("/", mockInboxRoute);
app.route("/", classifyRoute);
app.route("/", gmailConnectionRoute);
app.route("/", gmailSyncSettingsRoute);
app.route("/", gmailSortRoute);
app.route("/", triggerSyncRoute);
app.route("/", sweepInboxRoute);
app.route("/", syncStatusRoute);
app.route("/", triageRoute);
app.route("/", folderCountsRoute);
app.route("/", sortingQueueRoute);
app.route("/", draftsRoute);
app.route("/", resolveThreadRoute);
app.route("/", gmailWebhookRoute);
app.route("/", gmailWatchRoute);
app.route("/", workspaceEventsRoute);

export default app;
