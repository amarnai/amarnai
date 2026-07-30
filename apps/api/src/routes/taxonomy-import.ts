import { Hono } from "hono";
import { z } from "zod";
import { db, Prisma } from "@amarnai/db";
import {
  TaxonomyTransferFileSchema,
  TaxonomyImportRequestSchema,
  validateTaxonomyTransfer,
  normalizeTaxonomyImportRequest,
  MIGRATION_RESORT,
} from "@amarnai/shared";
import { DEDUP_CLASSIFY_MIGRATION } from "@amarnai/queue";
import { classifyThreadQueue } from "../queues.js";
import { enqueueFolderLabelProvisioning } from "../services/label-writeback.js";
import { computeMigrationPreview, latestClassificationsByThread } from "../services/taxonomy-migration.js";

const BODY_SIZE_LIMIT = 1_000_000; // 1 MB

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const taxonomyImport = new Hono();

// Statuses whose threads carry their folder over on migration (pointer remapped
// in place). QUOTA_BLOCKED keeps its status so quota recovery still re-sorts it
// later, but its folder continuity survives if its old folder is mapped.
const MIGRATABLE_STATUSES = new Set(["SORTED", "QUOTA_BLOCKED"]);

/**
 * POST /workspaces/:workspaceId/taxonomy-import/preview
 *
 * Computes the folder migration map for replacing the taxonomy with the posted
 * file, without applying anything. Advisory only — the apply route re-validates
 * and recomputes everything, so a stale preview can never corrupt the apply.
 */
taxonomyImport.post("/workspaces/:workspaceId/taxonomy-import/preview", async (c) => {
  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);
  const { workspaceId } = params.data;

  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > BODY_SIZE_LIMIT) return c.json({ error: "Request body too large" }, 413);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = TaxonomyTransferFileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "Invalid taxonomy file", issues: parsed.error.issues }, 400);
  }
  const validation = validateTaxonomyTransfer(parsed.data);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const existingRoot = await db.taxonomyNode.findFirst({
    where: { workspaceId, isRoot: true },
    select: { id: true },
  });
  if (!existingRoot) return c.json({ error: "Workspace taxonomy is not initialized" }, 422);

  const preview = await computeMigrationPreview(workspaceId, validation.data);
  return c.json(preview);
});

taxonomyImport.post("/workspaces/:workspaceId/taxonomy-import", async (c) => {
  const params = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }
  const { workspaceId } = params.data;

  // Body size guard before parsing
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > BODY_SIZE_LIMIT) {
    return c.json({ error: "Request body too large" }, 413);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Accept either a bare transfer file (legacy: re-sort everything) or
  // { file, mapping } (migrate mapped folders, re-sort the rest).
  const reqParsed = TaxonomyImportRequestSchema.safeParse(rawBody);
  if (!reqParsed.success) {
    return c.json({ error: "Invalid taxonomy file", issues: reqParsed.error.issues }, 400);
  }
  const { file: rawFile, mapping: rawMapping } = normalizeTaxonomyImportRequest(reqParsed.data);

  // Deep structural validation (graph validity, field rules, security)
  const validation = validateTaxonomyTransfer(rawFile);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }
  const file = validation.data;
  const fileRoot = file.nodes.find((n) => n.isRoot)!;
  const fileCatchAll = file.nodes.find((n) => n.isCatchAll)!;
  const fileNonRootRefs = new Set(file.nodes.filter((n) => !n.isRoot).map((n) => n.ref));

  // Find the existing root node for this workspace (preserved through import)
  const existingRoot = await db.taxonomyNode.findFirst({
    where: { workspaceId, isRoot: true },
    select: { id: true },
  });
  if (!existingRoot) {
    return c.json({ error: "Workspace taxonomy is not initialized" }, 422);
  }

  // ── Resolve the folder migration mapping ────────────────────────────────────
  // Load current non-root folders so we can drop mapping keys for folders another
  // editor deleted since the preview, and force the catch-all to map catch-all.
  const currentNodes = await db.taxonomyNode.findMany({
    where: { workspaceId, isRoot: false },
    select: { id: true, name: true, isCatchAll: true },
  });
  const currentById = new Map(currentNodes.map((n) => [n.id, n]));

  // oldNodeId -> new non-root ref (concrete migration targets only).
  const resolvedMapping = new Map<string, string>();
  for (const [oldNodeId, value] of Object.entries(rawMapping)) {
    if (value === MIGRATION_RESORT) continue; // explicit re-sort
    if (!currentById.has(oldNodeId)) continue; // folder deleted since preview — drop
    if (value === fileRoot.ref) {
      return c.json({ error: "Cannot map a folder to the root (Inbox)" }, 400);
    }
    if (!fileNonRootRefs.has(value)) {
      return c.json({ error: `Mapping targets unknown folder ref: "${value}"` }, 400);
    }
    resolvedMapping.set(oldNodeId, value);
  }
  // The catch-all always migrates to the incoming catch-all, regardless of client
  // input — its threads are automated/bulk mail that belongs in the new catch-all.
  const oldCatchAll = currentNodes.find((n) => n.isCatchAll);
  if (oldCatchAll) resolvedMapping.set(oldCatchAll.id, fileCatchAll.ref);

  // ── Partition threads by their latest classification ────────────────────────
  const latest = await latestClassificationsByThread(workspaceId);

  // Threads whose current folder is mapped → migrate the pointer (keep status).
  const migrateThreads: { emailThreadId: string; targetRef: string; oldNodeId: string }[] = [];
  // Threads to flip to PENDING and re-sort with AI.
  const resortThreadIds: string[] = [];
  for (const row of latest) {
    const mappedRef =
      row.finalNodeId != null ? resolvedMapping.get(row.finalNodeId) : undefined;

    if (mappedRef != null && MIGRATABLE_STATUSES.has(row.triageStatus)) {
      migrateThreads.push({
        emailThreadId: row.emailThreadId,
        targetRef: mappedRef,
        oldNodeId: row.finalNodeId!,
      });
      continue;
    }

    // Re-sort: review/unclassified threads, and SORTED threads whose folder was
    // not mapped (removed, or explicitly set to re-sort). PENDING and
    // QUOTA_BLOCKED are never flipped — they resume through their own paths.
    if (
      row.triageStatus === "NEEDS_REVIEW" ||
      row.triageStatus === "UNCLASSIFIED" ||
      (row.triageStatus === "SORTED" && mappedRef == null)
    ) {
      resortThreadIds.push(row.emailThreadId);
    }
  }

  const enqueuedAt = new Date();

  await db.$transaction(
    async (tx) => {
      // 1. Delete all edges in the workspace
      await tx.taxonomyEdge.deleteMany({ where: { workspaceId } });

      // 2. Clear all classification pointers (required before deleting the nodes
      //    they reference). Migrated threads get a fresh pointer in step 8.
      await tx.emailClassification.updateMany({
        where: { workspaceId, finalNodeId: { not: null } },
        data: { finalNodeId: null },
      });

      // 3. Delete all non-root nodes (and every reference pointing at them —
      //    the folders those human choices named no longer exist)
      await tx.taxonomyNodeReference.deleteMany({ where: { workspaceId } });
      await tx.taxonomyNode.deleteMany({ where: { workspaceId, isRoot: false } });

      // 4. Update root node (name + position only; keep isRoot: true)
      await tx.taxonomyNode.update({
        where: { id: existingRoot.id },
        data: {
          name: fileRoot.name,
          positionX: fileRoot.positionX,
          positionY: fileRoot.positionY,
          // Clear stale embedding — root name may have changed
          embeddingTextHash: null,
          embeddingVector: [],
          embeddingUpdatedAt: null,
        },
      });

      // Build ref -> DB id map using a Map (never a plain object — prototype-safe)
      const refToId = new Map<string, string>();
      refToId.set(fileRoot.ref, existingRoot.id);

      // 5. Create non-root nodes, one by one, capturing each new id
      for (const node of file.nodes) {
        if (node.isRoot) continue;
        const created = await tx.taxonomyNode.create({
          data: {
            workspaceId,
            isRoot: false,
            isCatchAll: node.isCatchAll ?? false,
            name: node.name,
            description: node.description,
            instructions: node.instructions ?? null,
            draftPrompt: node.draftPrompt ?? null,
            examples: node.examples,
            positionX: node.positionX,
            positionY: node.positionY,
            // Embeddings left at defaults; recomputed on next sort
          },
          select: { id: true },
        });
        refToId.set(node.ref, created.id);
      }

      // 6. Create edges using the ref map
      for (const edge of file.edges) {
        const sourceNodeId = refToId.get(edge.sourceRef)!;
        const targetNodeId = refToId.get(edge.targetRef)!;
        await tx.taxonomyEdge.create({
          data: { workspaceId, sourceNodeId, targetNodeId },
        });
      }

      // 7. Flip re-sort threads to PENDING and stamp classifyingAt inside the tx.
      //    Stamping here (not after commit) makes a crash between commit and
      //    enqueue self-healing: the sync cycle's stuck-classifying sweep
      //    re-enqueues PENDING threads with a stale classifyingAt.
      if (resortThreadIds.length > 0) {
        await tx.emailThread.updateMany({
          where: { id: { in: resortThreadIds } },
          data: { triageStatus: "PENDING", classifyingAt: enqueuedAt },
        });
      }

      // 8. Migration classification rows: carry mapped folders' threads over to
      //    their new folder instantly. New append-only row → becomes the thread's
      //    latest classification; its SORTED/QUOTA_BLOCKED status is untouched.
      //    This is the orphan-bug fix: no SORTED thread is left with a null
      //    pointer. MIGRATION source is quota-exempt (no embedding/LLM ran).
      if (migrateThreads.length > 0) {
        const rows = migrateThreads.map((t) => {
          const newNodeId = refToId.get(t.targetRef)!;
          const oldName = currentById.get(t.oldNodeId)?.name ?? "previous folder";
          const newName = file.nodes.find((n) => n.ref === t.targetRef)?.name ?? "new folder";
          return {
            workspaceId,
            emailThreadId: t.emailThreadId,
            finalNodeId: newNodeId,
            confidence: 1.0,
            explanation: `Folder migrated: "${oldName}" → "${newName}"`,
            needsHumanReview: false,
            source: "MIGRATION" as const,
            decisionSource: "migration",
            modelProvider: "system",
            modelName: "migration",
          };
        });
        // Chunk to keep individual statements small on large workspaces.
        const CHUNK = 1000;
        for (let i = 0; i < rows.length; i += CHUNK) {
          await tx.emailClassification.createMany({ data: rows.slice(i, i + CHUNK) });
        }
      }

      // 9. Mark the taxonomy changed (drives NEEDS_REVIEW re-sort eligibility).
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { taxonomyChangedAt: enqueuedAt },
      });

      // 10. Consume any pending generated proposal. An import replaces the
      //     taxonomy, so a READY generate-from-inbox proposal is now stale.
      //     Scoped to READY so a regeneration already RUNNING is not clobbered.
      await tx.taxonomyGenerationState.updateMany({
        where: { workspaceId, status: "READY" },
        data: { status: "IDLE", proposal: Prisma.DbNull, matchedTemplateId: null },
      });
    },
    { timeout: 60_000 }
  );

  // Post-commit: mirror the imported folders into the mailbox (writeback is on
  // by default; the job no-ops when the flag, toggle, or write scope is off).
  // Best-effort + deduped per workspace. This is the main bulk folder-creation
  // path (templates and generate-from-inbox both apply through it).
  await enqueueFolderLabelProvisioning(workspaceId, { relabelThreads: false });

  // Post-commit: enqueue the re-sort threads. They are already PENDING +
  // classifyingAt, so a failure here is recovered by the stuck-classifying sweep.
  if (resortThreadIds.length > 0) {
    await classifyThreadQueue.addBulk(
      resortThreadIds.map((emailThreadId) => ({
        name: "classify-thread",
        data: { workspaceId, emailThreadId, source: "REROUTE" as const },
        opts: {
          deduplication: { id: `${DEDUP_CLASSIFY_MIGRATION}_${workspaceId}_${emailThreadId}` },
          priority: 5,
        },
      }))
    );
  }

  return c.json({
    ok: true,
    nodeCount: file.nodes.length,
    edgeCount: file.edges.length,
    migratedThreads: migrateThreads.length,
    requeuedThreads: resortThreadIds.length,
  });
});

export { taxonomyImport as taxonomyImportRoute };
