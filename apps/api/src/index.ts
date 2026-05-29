import { serve } from "@hono/node-server";
import { db } from "@amarnai/db";
import app from "./app.js";

const PORT = Number(process.env["PORT"] ?? 3001);

// Drafts stuck in GENERATING from a previous server run will never resolve on
// their own. Reset them to FAILED before accepting new requests.
async function recoverStuckDrafts() {
  const { count } = await db.draft.updateMany({
    where: { status: "GENERATING" },
    data: { status: "FAILED", errorMessage: "Server restarted during generation" },
  });
  if (count > 0) {
    console.log(`[startup] Reset ${count} stuck GENERATING draft(s) to FAILED`);
  }
}

await recoverStuckDrafts();

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
