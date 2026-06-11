import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * deleteAccountAction (actions/auth.ts) deletes emailAccounts by userId but
 * workspaces/threads by ownerUserId. Those two scopes only coincide while the
 * OWNER role is granted exclusively to the workspace creator (ownerUserId),
 * because Gmail connect is gated on the OWNER role.
 *
 * This test trips when a new OWNER-role write site appears (e.g. member
 * promotion or ownership transfer). If it failed because you added one:
 * revisit the deletion scopes in deleteAccountAction first, then add the new
 * file to the allowlist below.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const SCAN_ROOTS = ["apps/web/src", "apps/api/src", "apps/worker/src"];

// Files allowed to grant the OWNER role. In each, the member being created is
// the same user stored as workspace.ownerUserId.
const ALLOWED_OWNER_GRANT_FILES = new Set([
  "apps/web/src/actions/workspace.ts",
  "apps/web/src/lib/workspace.ts",
  "apps/web/src/app/(app)/upgrade/success/page.tsx",
  "apps/web/src/app/api/billing/webhook/route.ts",
]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((root) => {
  const abs = path.join(REPO_ROOT, root);
  return existsSync(abs) ? listSourceFiles(abs) : [];
});

describe("OWNER role is only ever granted to the workspace creator", () => {
  it("scans a plausible amount of source", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no OWNER-role grants outside the allowlisted creation paths", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // `NOT: { role: "OWNER" }` and similar filters are reads, not grants.
        const isGrant = line.includes('role: "OWNER"') && !line.includes("NOT:");
        if (isGrant && !ALLOWED_OWNER_GRANT_FILES.has(rel)) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("has no workspaceMember role mutations (promotion / ownership transfer)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const content = readFileSync(file, "utf8");
      if (/workspaceMember\.(update|updateMany|upsert)/.test(content)) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
