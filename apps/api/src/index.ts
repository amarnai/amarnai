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

// Same for thread summaries: a GENERATING row from a killed process would
// otherwise make every open of that thread poll a generation that will never land.
//
// Deliberately non-fatal, unlike the draft sweep above. Migrations run as a
// SEPARATE deploy unit with no ordering guarantee against this one, so on the
// release that first ships ThreadSummary the API can boot against a schema that
// does not have the table yet. A top-level throw there would crash-loop the whole
// API over a best-effort cleanup. Summaries 500 (and the UI shows its retry card)
// until the migration lands, then self-heal; everything else keeps serving.
async function recoverStuckSummaries() {
  try {
    const { count } = await db.threadSummary.updateMany({
      where: { status: "GENERATING" },
      data: { status: "FAILED", errorMessage: "Server restarted during generation" },
    });
    if (count > 0) {
      console.log(`[startup] Reset ${count} stuck GENERATING thread summary(ies) to FAILED`);
    }
  } catch (e) {
    console.error(
      `[startup] Could not sweep stuck thread summaries (is the ThreadSummary migration applied?): ${String(e)}`,
    );
  }
}

await recoverStuckDrafts();
await recoverStuckSummaries();

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
