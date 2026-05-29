import { Hono } from "hono";
import { cors } from "hono/cors";
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

const app = new Hono();

app.use("*", cors({ origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000" }));

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

export default app;
