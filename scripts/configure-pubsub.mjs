#!/usr/bin/env node
/**
 * Points the Pub/Sub push subscription at the deployed API endpoint.
 * Run this once after deploying (or any time the API URL changes).
 *
 * Usage: pnpm configure:pubsub
 *
 * Reads from environment variables or .env / .env.local:
 *   API_URL                    — base URL of the deployed API, e.g. https://api.yourdomain.com
 *   GMAIL_PUBSUB_TOPIC         — "projects/<project-id>/topics/<topic-name>"
 *   GMAIL_PUBSUB_WEBHOOK_SECRET — secret embedded in the push endpoint URL
 *   GMAIL_PUBSUB_SUBSCRIPTION  — subscription to update (default: amarnai-gmail-sub)
 *
 * Requirements: gcloud CLI — https://cloud.google.com/sdk/docs/install
 */

import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
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

const apiUrl         = loadEnv("API_URL");
const webhookSecret  = loadEnv("GMAIL_PUBSUB_WEBHOOK_SECRET");
const pubsubTopic    = loadEnv("GMAIL_PUBSUB_TOPIC");
const subscription   = loadEnv("GMAIL_PUBSUB_SUBSCRIPTION") ?? "amarnai-gmail-sub";

const missing = [
  !apiUrl           && "API_URL",
  !webhookSecret    && "GMAIL_PUBSUB_WEBHOOK_SECRET",
  !pubsubTopic      && "GMAIL_PUBSUB_TOPIC",
].filter(Boolean);

if (missing.length) {
  console.error(`Error: missing required env vars: ${missing.join(", ")}`);
  console.error("Set them in .env or pass them inline:");
  console.error("  API_URL=https://api.yourdomain.com pnpm configure:pubsub");
  process.exit(1);
}

const gcpProject = pubsubTopic.match(/projects\/([^/]+)/)?.[1];
if (!gcpProject) {
  console.error("Error: cannot parse GCP project from GMAIL_PUBSUB_TOPIC:", pubsubTopic);
  process.exit(1);
}

const pushEndpoint = `${apiUrl}/webhooks/gmail?token=${webhookSecret}`;

console.log(`Updating Pub/Sub subscription "${subscription}" in project "${gcpProject}"...`);
console.log(`  → ${pushEndpoint}\n`);

try {
  execFileSync(
    "gcloud",
    [
      "pubsub", "subscriptions", "modify-push-config", subscription,
      `--project=${gcpProject}`,
      `--push-endpoint=${pushEndpoint}`,
    ],
    { stdio: "inherit" }
  );
  console.log("\n✓ Pub/Sub push endpoint updated. Gmail notifications will now reach the API.");
} catch {
  console.error("\nFailed to update Pub/Sub. Run manually:");
  console.error(
    `  gcloud pubsub subscriptions modify-push-config ${subscription}` +
    ` --project=${gcpProject} --push-endpoint="${pushEndpoint}"`
  );
  process.exit(1);
}
