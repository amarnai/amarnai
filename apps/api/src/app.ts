import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "@amarnai/config";
import { db } from "@amarnai/db";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.js";
import { healthRoute } from "./routes/health.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { taxonomyNodesRoute } from "./routes/taxonomy-nodes.js";
import { taxonomyEdgesRoute } from "./routes/taxonomy-edges.js";
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

app.use("*", async (c, next) => {
  // /health and /webhooks/gmail use their own auth — skip internal secret check.
  if (c.req.path === "/health" || c.req.path === "/webhooks/gmail") return next();

  const secret = config.internalApiSecret;
  if (!secret) return c.json({ error: "Unauthorized" }, 401);

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const tokenBuf = Buffer.from(token, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = c.req.header("X-User-Id");
  if (userId) c.set("userId", userId);

  return next();
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
app.route("/", workspacesRoute);
app.route("/", taxonomyNodesRoute);
app.route("/", taxonomyEdgesRoute);
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
