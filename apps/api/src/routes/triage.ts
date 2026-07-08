import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import type { AppEnv } from "../env.js";
import { recordAudit } from "../services/audit.js";
import { captureReferenceQueue } from "../queues.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const approveBody = z.object({ action: z.literal("approve") });
// retractReference — set by the Undo toast when reverting a move: undo means
// "my move was a mistake", not "I confirm the old folder", so the thread's
// reference row is deleted instead of repointed at the restored folder.
const moveBody = z.object({
  action: z.literal("move"),
  nodeId: z.string().min(1),
  retractReference: z.boolean().optional(),
});
const bodySchema = z.union([approveBody, moveBody]);

/**
 * Pull the embedding quality-gate score from a classification's routing
 * telemetry, or null when absent (manual rows, no-text rows, or a legacy row
 * persisted before telemetry existed). Recorded on the triage audit event so
 * thetaMin can later be recalibrated on real (score → user-chosen folder)
 * labels without a fragile temporal self-join.
 */
function extractScoreAtDecision(rawOutput: unknown): number | null {
  if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const value = (rawOutput as Record<string, unknown>).maxSubtreeScore;
    if (typeof value === "number") return value;
  }
  return null;
}

const triage = new Hono<AppEnv>();

// ─── PATCH /workspaces/:workspaceId/email-threads/:threadId/triage ────────────
//
// Two actions:
//  • approve — mark thread SORTED without changing destination
//  • move    — create a manual classification to a chosen node, mark SORTED
//
// Both actions emit a best-effort audit event ("thread.approved" /
// "thread.moved") that doubles as a calibration label: it pairs the AI
// decision being judged (its id, quality-gate score, decisionSource, and
// destination) with the user's verdict (the folder they confirmed or chose).
// Approve is a positive label (AI destination accepted); move is a correction.
// Capturing both avoids an error-only dataset that would bias thetaMin downward.

triage.patch(
  "/workspaces/:workspaceId/email-threads/:threadId/triage",
  async (c) => {
    const parsed = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;
    // The actor is always the authenticated member; requireWorkspaceMember has
    // already confirmed membership. Never read the actor id from the body (IDOR).
    const userId = c.get("userId");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: "Invalid action. Expected 'approve' or 'move' with nodeId." }, 400);
    }

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true, triageStatus: true },
    });
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // The AI decision the user is reacting to: the most recent classification on
    // this thread. Fetched before any mutation so a move's own manual row does
    // not shadow the decision being overridden. rawOutput carries the
    // quality-gate score for AI-sourced rows (null for manual/no-text rows).
    const priorClassification = await db.emailClassification.findFirst({
      where: { emailThreadId: threadId, workspaceId },
      orderBy: { createdAt: "desc" },
      select: { id: true, finalNodeId: true, decisionSource: true, source: true, rawOutput: true },
    });
    const scoreAtDecision = extractScoreAtDecision(priorClassification?.rawOutput);

    const action = parsedBody.data;

    if (action.action === "approve") {
      // ── Approve: accept the current AI destination, mark SORTED ──────────────
      await db.emailThread.update({
        where: { id: threadId },
        data: { triageStatus: "SORTED" },
      });

      // Positive calibration label: the AI destination was confirmed correct, so
      // chosenNodeId equals the AI's own finalNodeId.
      await recordAudit({
        workspaceId,
        actorType: "USER",
        actorUserId: userId,
        eventType: "thread.approved",
        entityType: "EmailThread",
        entityId: threadId,
        metadata: {
          classificationId: priorClassification?.id ?? null,
          scoreAtDecision,
          decisionSource: priorClassification?.decisionSource ?? null,
          aiSource: priorClassification?.source ?? null,
          aiNodeId: priorClassification?.finalNodeId ?? null,
          chosenNodeId: priorClassification?.finalNodeId ?? null,
          priorTriageStatus: thread.triageStatus,
        },
      });

      return c.json({ ok: true, triageStatus: "SORTED" });
    }

    // ── Move: create a manual classification to the chosen node ──────────────
    const { nodeId } = action;

    const node = await db.taxonomyNode.findFirst({
      where: { id: nodeId, workspaceId },
      select: { id: true, name: true, isRoot: true, isCatchAll: true },
    });
    if (!node) {
      return c.json({ error: "Taxonomy node not found" }, 404);
    }

    // A manual move is the ONLY writer of TaxonomyNodeReference rows (routing
    // exemplars): no AI path may create one, or the sorter would reinforce its
    // own decisions. Root and catch-all are not reference destinations (root is
    // the stay-put default, catch-all is excluded from scoring), and both — like
    // an Undo retraction — clear any existing reference so it always reflects
    // the thread's LATEST human destination.
    const referenceable = !action.retractReference && !node.isRoot && !node.isCatchAll;

    await db.$transaction(async (tx) => {
      await tx.emailClassification.create({
        data: {
          workspaceId,
          emailThreadId: threadId,
          finalNodeId: nodeId,
          confidence: 1.0,
          explanation: `Manually moved to "${node.name}" by user.`,
          needsHumanReview: false,
          // MOVE: a manual folder reassignment runs no embedding/LLM, so it is
          // exempt from the monthly thread-sort quota (see thread-sort-usage).
          source: "MOVE",
          decisionSource: "manual",
          modelProvider: "user",
          modelName: "manual",
        },
      });

      if (referenceable) {
        // Re-moves repoint nodeId and keep the content-derived vector; the
        // capture job below no-ops when the vector is already current.
        await tx.taxonomyNodeReference.upsert({
          where: { emailThreadId: threadId },
          create: { workspaceId, nodeId, emailThreadId: threadId },
          update: { nodeId },
        });
      } else {
        await tx.taxonomyNodeReference.deleteMany({
          where: { emailThreadId: threadId, workspaceId },
        });
      }

      await tx.emailThread.update({
        where: { id: threadId },
        data: { triageStatus: "SORTED" },
      });
    });

    // Best-effort like recordAudit: the reference is a routing hint, so a lost
    // enqueue must never fail the move. The pending (empty-vector) row is
    // skipped by the sort-time loader and healed by the next move or retry.
    if (referenceable) {
      try {
        await captureReferenceQueue.add("capture-reference", {
          workspaceId,
          emailThreadId: threadId,
        });
      } catch (err) {
        console.error(
          `[triage] capture-reference enqueue failed for thread ${threadId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Correction label: the AI decision (aiNodeId, possibly null for a
    // quality-gate fallback) at score scoreAtDecision was overridden to
    // chosenNodeId. Written after the transaction commits so only a successful
    // move is audited; recordAudit is best-effort and never fails the request.
    await recordAudit({
      workspaceId,
      actorType: "USER",
      actorUserId: userId,
      eventType: "thread.moved",
      entityType: "EmailThread",
      entityId: threadId,
      metadata: {
        classificationId: priorClassification?.id ?? null,
        scoreAtDecision,
        decisionSource: priorClassification?.decisionSource ?? null,
        aiSource: priorClassification?.source ?? null,
        aiNodeId: priorClassification?.finalNodeId ?? null,
        chosenNodeId: nodeId,
        priorTriageStatus: thread.triageStatus,
      },
    });

    return c.json({ ok: true, triageStatus: "SORTED", movedToNodeId: nodeId });
  }
);

export { triage as triageRoute };
