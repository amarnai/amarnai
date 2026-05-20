import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoute } from "./routes/health.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { taxonomyNodesRoute } from "./routes/taxonomy-nodes.js";
import { taxonomyEdgesRoute } from "./routes/taxonomy-edges.js";
import { tagsRoute } from "./routes/tags.js";
import { emailThreadsRoute } from "./routes/email-threads.js";
import { reviewItemsRoute } from "./routes/review-items.js";
import { mockInboxRoute } from "./routes/mock-inbox.js";
import { classifyRoute } from "./routes/classify.js";
import { gmailConnectionRoute } from "./routes/gmail-connection.js";

const app = new Hono();

app.use("*", cors({ origin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000" }));

app.route("/", healthRoute);
app.route("/", workspacesRoute);
app.route("/", taxonomyNodesRoute);
app.route("/", taxonomyEdgesRoute);
app.route("/", tagsRoute);
app.route("/", emailThreadsRoute);
app.route("/", reviewItemsRoute);
app.route("/", mockInboxRoute);
app.route("/", classifyRoute);
app.route("/", gmailConnectionRoute);

export default app;
