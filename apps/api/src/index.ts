import { serve } from "@hono/node-server";
import app from "./app.js";

const PORT = Number(process.env["PORT"] ?? 3001);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
