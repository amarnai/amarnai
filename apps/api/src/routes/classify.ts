import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { mockClassify } from "../services/mock-classifier.js";
import { classifyThreadQueue } from "../queues.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const classify = new Hono();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/ai-classify ─────────
//
// Enqueues a classify-thread BullMQ job and returns immediately (202).
// The worker stamps classifyingAt on the thread, runs the AI, then clears it.
// Callers should poll the thread until isClassifying is false and a
// classification result is present.

classify.post(
  "/workspaces/:workspaceId/email-threads/:threadId/ai-classify",
  async (c) => {
    const parsed = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true },
    });
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const nodeCount = await db.taxonomyNode.count({ where: { workspaceId } });
    if (nodeCount === 0) {
      return c.json({ error: "No taxonomy nodes found for classification" }, 422);
    }

    // Stamp classifyingAt immediately so the UI shows the indicator before
    // the worker has had a chance to pick up the job.
    await db.emailThread.update({
      where: { id: threadId },
      data: { classifyingAt: new Date() },
    });

    // Deterministic jobId: deduplicates rapid re-clicks while respecting BullMQ's
    // deduplication semantics (unlike a fixed jobId, this doesn't block re-queuing
    // after a job completes).
    const job = await classifyThreadQueue.add(
      "classify-thread",
      { workspaceId, emailThreadId: threadId },
      { deduplication: { id: `classify_${workspaceId}_${threadId}` } }
    );

    console.log(
      `[classify] Enqueued classify-thread job ${job?.id ?? "(deduped)"} for thread ${threadId} (workspace ${workspaceId})`
    );

    return c.json({ queued: true }, 202);
  }
);

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/mock-classify ───────

classify.post(
  "/workspaces/:workspaceId/email-threads/:threadId/mock-classify",
  async (c) => {
    const parsed = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: {
        id: true,
        messages: {
          orderBy: { receivedAt: "asc" },
          select: {
            subject: true,
            senderEmail: true,
            senderName: true,
            bodyText: true,
          },
        },
      },
    });
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const nodes = await db.taxonomyNode.findMany({
      where: { workspaceId },
      select: { id: true, name: true, isRoot: true },
    });

    if (nodes.length === 0) {
      return c.json({ error: "No taxonomy nodes found for classification" }, 422);
    }

    const result = mockClassify(thread.messages, nodes);

    const classification = await db.emailClassification.create({
      data: {
        workspaceId,
        emailThreadId: threadId,
        finalNodeId: result.finalNodeId,
        confidence: result.confidence,
        explanation: result.explanation,
        priority: result.priority,
        urgency: result.urgency,
        riskLevel: result.riskLevel,
        requiredAction: result.requiredAction,
        sensitivity: result.sensitivity,
        suggestedNextStep: result.suggestedNextStep,
        needsHumanReview: result.needsHumanReview,
        modelProvider: "mock",
        modelName: "mock-classifier-v1",
        promptVersion: "1.0.0",
      },
      select: { id: true },
    });

    await db.emailThread.update({
      where: { id: threadId },
      data: { triageStatus: result.needsHumanReview ? "NEEDS_REVIEW" : "SORTED" },
    });

    return c.json(
      {
        classification: {
          id: classification.id,
          finalNodeId: result.finalNodeId,
          confidence: result.confidence,
          explanation: result.explanation,
          priority: result.priority,
          urgency: result.urgency,
          riskLevel: result.riskLevel,
          requiredAction: result.requiredAction,
          sensitivity: result.sensitivity,
          suggestedNextStep: result.suggestedNextStep,
          needsHumanReview: result.needsHumanReview,
          modelProvider: "mock",
          modelName: "mock-classifier-v1",
        },
      },
      201
    );
  }
);

export { classify as classifyRoute };
