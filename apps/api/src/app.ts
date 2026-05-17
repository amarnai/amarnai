import { Hono } from "hono";
import { healthRoute } from "./routes/health.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { taxonomyNodesRoute } from "./routes/taxonomy-nodes.js";
import { tagsRoute } from "./routes/tags.js";
import { emailThreadsRoute } from "./routes/email-threads.js";
import { reviewItemsRoute } from "./routes/review-items.js";

const app = new Hono();

app.route("/", healthRoute);
app.route("/", workspacesRoute);
app.route("/", taxonomyNodesRoute);
app.route("/", tagsRoute);
app.route("/", emailThreadsRoute);
app.route("/", reviewItemsRoute);

export default app;
