import {
  DEFAULT_CATCH_ALL_NAME,
  DEFAULT_CATCH_ALL_DESCRIPTION,
  DEFAULT_CATCH_ALL_SEED_POSITION,
} from "@amarnai/shared";
import { db } from "./client.js";

// Ensure a workspace has its two mandatory taxonomy nodes: the root ("Inbox")
// and the catch-all ("Updates / Other"). Idempotent and safe to call on new,
// existing, or partially-seeded workspaces — it backfills only what is missing.
// Every workspace-creation path must call this (never seed the root alone),
// otherwise automated/bulk mail has no home and generation/import invariants
// about a single catch-all are violated.
export async function ensureInboxTaxonomy(workspaceId: string): Promise<void> {
  const rootId = await ensureRootNode(workspaceId);
  await ensureCatchAllNode(workspaceId, rootId);
}

async function ensureRootNode(workspaceId: string): Promise<string> {
  const existing = await db.taxonomyNode.findFirst({
    where: { workspaceId, isRoot: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.taxonomyNode.create({
    data: { workspaceId, name: "Inbox", isRoot: true },
    select: { id: true },
  });
  return created.id;
}

async function ensureCatchAllNode(workspaceId: string, rootId: string): Promise<void> {
  const existing = await db.taxonomyNode.findFirst({
    where: { workspaceId, isCatchAll: true },
    select: { id: true },
  });
  if (existing) return;

  // Create the node and its root edge atomically so a failure can never leave
  // an orphan catch-all that is unreachable from the inbox.
  await db.$transaction(async (tx) => {
    const node = await tx.taxonomyNode.create({
      data: {
        workspaceId,
        name: DEFAULT_CATCH_ALL_NAME,
        description: DEFAULT_CATCH_ALL_DESCRIPTION,
        isCatchAll: true,
        positionX: DEFAULT_CATCH_ALL_SEED_POSITION.x,
        positionY: DEFAULT_CATCH_ALL_SEED_POSITION.y,
      },
      select: { id: true },
    });
    await tx.taxonomyEdge.create({
      data: { workspaceId, sourceNodeId: rootId, targetNodeId: node.id },
    });
  });
}
