#!/usr/bin/env node
/**
 * Exposes the local API (port 3001) through a Cloudflare tunnel so provider push
 * notifications reach local dev, and points each provider at it.
 *
 * Two modes:
 *
 *   Named tunnel — DEV_TUNNEL_HOSTNAME set to a stable hostname on a domain you
 *     own. Serves Gmail *and* Outlook. Graph bakes the notification URL into
 *     every subscription at creation and its update operation only accepts a new
 *     expiry, so Outlook push needs a URL that survives across dev sessions.
 *     Requires a one-time `cloudflared tunnel login/create/route dns`; the
 *     script prints the exact commands when that setup is missing.
 *
 *   Quick tunnel — no hostname configured. An ephemeral *.trycloudflare.com URL,
 *     rewritten into the Pub/Sub push endpoint on every run. Gmail only.
 *
 * Usage: pnpm tunnel
 *        node scripts/dev-tunnel.mjs --if-configured   (used by `pnpm dev`)
 *
 * With --if-configured the script exits 0 without an error whenever push
 * notifications are not set up locally (env vars unset, cloudflared missing or
 * unconfigured, DEV_TUNNEL=0). `pnpm dev` runs it that way so a dev environment
 * without push still starts normally and falls back to polling.
 *
 * Requirements:
 *   - cloudflared  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 *   - gcloud CLI   https://cloud.google.com/sdk/docs/install  (Gmail only)
 */

import { spawn, execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_ORIGIN = "http://127.0.0.1:3001";

const CLOUDFLARED_INSTALL =
  "Install it from:\n" +
  "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

// Auto-start mode: never fail the surrounding `pnpm dev` over a missing optional
// dev dependency.
const optional = process.argv.includes("--if-configured");

/** Skip cleanly in auto-start mode; hard-fail when run directly. */
function bail(reason, hint) {
  if (optional) {
    console.error(`Dev tunnel skipped: ${reason}`);
    if (hint) console.error(hint);
    process.exit(0);
  }
  console.error(`Error: ${reason}`);
  if (hint) console.error(hint);
  process.exit(1);
}

/** Reads a var from the environment, falling back to .env.local then .env. */
function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", ".env"]) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    // Last occurrence wins within a file, matching how dotenv parses the same
    // file for the API and worker — a duplicated key must not leave the tunnel
    // and the apps reading different values.
    const line = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.startsWith(`${key}=`))
      .pop();
    if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

// Opt out of the auto-started tunnel without editing scripts. Ignored when the
// tunnel is launched explicitly via `pnpm tunnel`.
if (optional && /^(0|false|no)$/i.test(process.env.DEV_TUNNEL ?? "")) {
  console.error("Dev tunnel skipped: DEV_TUNNEL=0");
  process.exit(0);
}

const hostname      = loadEnv("DEV_TUNNEL_HOSTNAME");
const webhookSecret = loadEnv("GMAIL_PUBSUB_WEBHOOK_SECRET");
const pubsubTopic   = loadEnv("GMAIL_PUBSUB_TOPIC");
const outlookUrl    = loadEnv("MS_GRAPH_NOTIFICATION_URL");
const gmailConfigured = Boolean(webhookSecret && pubsubTopic);

// Default to the dev-only subscription so this script never overwrites the
// production endpoint. Set GMAIL_PUBSUB_SUBSCRIPTION in .env.local to override.
const SUBSCRIPTION = loadEnv("GMAIL_PUBSUB_SUBSCRIPTION") ?? "amarnai-gmail-sub-dev";

const gcpProject = pubsubTopic?.match(/projects\/([^/]+)/)?.[1] ?? null;
if (pubsubTopic && !gcpProject) {
  bail(`cannot parse GCP project from GMAIL_PUBSUB_TOPIC: ${pubsubTopic}`);
}

// ─── Gmail: Pub/Sub push endpoint ─────────────────────────────────────────────

/** Current push endpoint of the dev subscription, or null if it cannot be read. */
function readPushEndpoint() {
  try {
    return execFileSync(
      "gcloud",
      [
        "pubsub", "subscriptions", "describe", SUBSCRIPTION,
        `--project=${gcpProject}`,
        "--format=value(pushConfig.pushEndpoint)",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Points the dev Pub/Sub subscription at `pushEndpoint`. Idempotent: with a
 * named tunnel the endpoint never changes, so after the first run this is a
 * read-only check that leaves a teammate's endpoint alone.
 */
function syncPushEndpoint(pushEndpoint) {
  if (readPushEndpoint() === pushEndpoint) {
    console.error("✓ Gmail Pub/Sub push endpoint already up to date.");
    return;
  }

  console.error("Updating Pub/Sub push endpoint…");
  try {
    execFileSync(
      "gcloud",
      [
        "pubsub", "subscriptions", "modify-push-config", SUBSCRIPTION,
        `--project=${gcpProject}`,
        `--push-endpoint=${pushEndpoint}`,
      ],
      { stdio: "inherit" },
    );
    console.error("✓ Gmail push notifications routed to local dev.");
  } catch {
    console.error("\nFailed to update Pub/Sub. Run manually:");
    console.error(
      `  gcloud pubsub subscriptions modify-push-config ${SUBSCRIPTION}` +
      ` --project=${gcpProject} --push-endpoint="${pushEndpoint}"`,
    );
  }
}

// ─── Named tunnel ─────────────────────────────────────────────────────────────

/**
 * Verifies the one-time Cloudflare setup for a named tunnel, printing the exact
 * commands when something is missing. Creating a tunnel and its DNS record
 * touches a real domain, so the script never does that unprompted.
 */
function checkNamedTunnel(tunnelName) {
  const setup =
    "One-time setup:\n" +
    "  cloudflared tunnel login\n" +
    `  cloudflared tunnel create ${tunnelName}\n` +
    `  cloudflared tunnel route dns ${tunnelName} ${hostname}`;

  if (!existsSync(join(homedir(), ".cloudflared", "cert.pem"))) {
    bail("cloudflared is not logged in to Cloudflare", setup);
  }
  try {
    execFileSync("cloudflared", ["tunnel", "info", tunnelName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch (err) {
    if (err.code === "ENOENT") bail("cloudflared not found", CLOUDFLARED_INSTALL);
    bail(`no Cloudflare tunnel named "${tunnelName}"`, setup);
  }
}

// ─── Mode selection ───────────────────────────────────────────────────────────

/** cloudflared argv for the selected mode. */
let args;
/** Per-line handler for cloudflared output. */
let onLine;

if (hostname) {
  // The tunnel name defaults to the first DNS label, which keeps each
  // developer's tunnel distinct on a shared domain (dev-ben.aziru.email →
  // "dev-ben").
  const tunnelName = loadEnv("DEV_TUNNEL_NAME") ?? hostname.split(".")[0];
  const base = `https://${hostname}`;

  checkNamedTunnel(tunnelName);

  console.error(`Starting Cloudflare tunnel "${tunnelName}" → ${base} → ${API_ORIGIN}\n`);

  if (gmailConfigured) {
    syncPushEndpoint(`${base}/webhooks/gmail?token=${webhookSecret}`);
  } else {
    console.error("· Gmail push not configured (GMAIL_PUBSUB_TOPIC unset), skipping.");
  }

  // Graph reads its notification URL from env when a subscription is created, so
  // the script cannot repoint existing subscriptions. A mismatch leaves Outlook
  // push silently inert, so report it with the line that fixes it rather than
  // failing the tunnel Gmail may still be using.
  const expectedOutlook = `${base}/webhooks/outlook`;
  if (outlookUrl === expectedOutlook) {
    console.error("✓ Outlook Graph notification URL matches this tunnel.");
  } else {
    console.error(
      "! Outlook push inactive. Set this in .env.local, then restart the worker:\n" +
      `    MS_GRAPH_NOTIFICATION_URL=${expectedOutlook}` +
      (outlookUrl ? `\n  (currently ${outlookUrl})` : ""),
    );
  }
  console.error("");

  args = ["tunnel", "run", "--url", API_ORIGIN, tunnelName];
  onLine = (line) => process.stderr.write(line + "\n");
} else {
  // Quick-tunnel mode: the hostname changes every run, so only Gmail can use it.
  if (!gmailConfigured) {
    bail(
      "no push notifications configured",
      "Set DEV_TUNNEL_HOSTNAME (Gmail + Outlook), or GMAIL_PUBSUB_TOPIC and\n" +
      "GMAIL_PUBSUB_WEBHOOK_SECRET (Gmail only). See the README.",
    );
  }
  if (outlookUrl?.startsWith("https://")) {
    console.error(
      "! Quick tunnel: Outlook push keeps using the configured\n" +
      `  MS_GRAPH_NOTIFICATION_URL (${outlookUrl}), which this tunnel does not serve.\n` +
      "  Set DEV_TUNNEL_HOSTNAME for a stable URL that Graph subscriptions can keep.",
    );
  }

  console.error(`Starting Cloudflare quick tunnel → ${API_ORIGIN}\n`);

  let configured = false;
  args = ["tunnel", "--url", API_ORIGIN];
  onLine = (line) => {
    process.stderr.write(line + "\n");
    if (configured) return;

    const m = line.match(/https:\/\/[^\s|]+\.trycloudflare\.com/);
    if (!m) return;
    configured = true;

    console.error(`\nTunnel URL: ${m[0]}`);
    syncPushEndpoint(`${m[0]}/webhooks/gmail?token=${webhookSecret}`);
    console.error("  Press Ctrl+C to stop.\n");
  };
}

// ─── Run cloudflared ──────────────────────────────────────────────────────────

const proc = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] });

proc.on("error", (err) => {
  if (err.code === "ENOENT") bail("cloudflared not found", CLOUDFLARED_INSTALL);
  bail(`cloudflared error: ${err.message}`);
});

let stopping = false;
let buf = "";

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
  // In auto-start mode a dead tunnel must not take `pnpm dev` down with it.
  process.exit(stopping || optional ? 0 : (code ?? 0));
});

process.on("SIGINT", () => {
  console.error("\nStopping tunnel…");
  stopping = true;
  proc.kill("SIGTERM");
});
