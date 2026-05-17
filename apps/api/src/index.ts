import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

const PORT = Number(process.env["PORT"] ?? 3001);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
