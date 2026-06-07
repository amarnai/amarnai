#!/usr/bin/env node
/**
 * Starts a Cloudflare quick tunnel exposing the local API (port 3001) and
 * automatically updates the Pub/Sub push subscription to point at it.
 *
 * Usage: pnpm tunnel
 *
 * Requirements:
 *   - cloudflared  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 *   - gcloud CLI   https://cloud.google.com/sdk/docs/install
 *   - GMAIL_PUBSUB_TOPIC and GMAIL_PUBSUB_WEBHOOK_SECRET set in .env or .env.local
 */

import { spawn, execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(key) {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim();
  }
  return null;
}

const webhookSecret = loadEnv("GMAIL_PUBSUB_WEBHOOK_SECRET");
const pubsubTopic   = loadEnv("GMAIL_PUBSUB_TOPIC");

if (!webhookSecret || !pubsubTopic) {
  console.error(
    "Error: GMAIL_PUBSUB_WEBHOOK_SECRET and GMAIL_PUBSUB_TOPIC must be set in .env or .env.local\n" +
    "See the README for setup instructions."
  );
  process.exit(1);
}

const gcpProject = pubsubTopic.match(/projects\/([^/]+)/)?.[1];
if (!gcpProject) {
  console.error("Error: cannot parse GCP project from GMAIL_PUBSUB_TOPIC:", pubsubTopic);
  process.exit(1);
}

const SUBSCRIPTION = loadEnv("GMAIL_PUBSUB_SUBSCRIPTION") ?? "amarnai-gmail-sub-dev";

console.log("Starting Cloudflare quick tunnel → http://localhost:3001\n");

const proc = spawn("cloudflared", ["tunnel", "--url", "http://127.0.0.1:3001"], {
  stdio: ["ignore", "pipe", "pipe"],
});

proc.on("error", (err) => {
  if (err.code === "ENOENT") {
    console.error(
      "cloudflared not found. Install it from:\n" +
      "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    );
  } else {
    console.error("cloudflared error:", err.message);
  }
  process.exit(1);
});

let configured = false;
let stopping = false;
let buf = "";

function onLine(line) {
  process.stderr.write(line + "\n");
  if (configured) return;

  const m = line.match(/https:\/\/[^\s|]+\.trycloudflare\.com/);
  if (!m) return;

  const tunnelUrl   = m[0];
  const pushEndpoint = `${tunnelUrl}/webhooks/gmail?token=${webhookSecret}`;

  console.error(`\nTunnel URL: ${tunnelUrl}`);
  console.error("Updating Pub/Sub push endpoint…\n");

  try {
    execFileSync("gcloud", [
      "pubsub", "subscriptions", "modify-push-config", SUBSCRIPTION,
      `--project=${gcpProject}`,
      `--push-endpoint=${pushEndpoint}`,
    ], { stdio: "inherit" });
    configured = true;
    console.error("\n✓ Gmail push notifications routed to local dev.");
    console.error("  Press Ctrl+C to stop.\n");
  } catch {
    console.error("\nFailed to update Pub/Sub. Run manually:");
    console.error(
      `  gcloud pubsub subscriptions modify-push-config ${SUBSCRIPTION}` +
      ` --project=${gcpProject} --push-endpoint="${pushEndpoint}"`
    );
  }
}

for (const stream of [proc.stdout, proc.stderr]) {
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
}

proc.on("exit", (code) => {
  if (buf) onLine(buf);
  process.exit(stopping ? 0 : (code ?? 0));
});

process.on("SIGINT", () => {
  console.error("\nStopping tunnel…");
  stopping = true;
  proc.kill("SIGTERM");
});
