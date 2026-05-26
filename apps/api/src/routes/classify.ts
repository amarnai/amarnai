import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { createAIProvider, createEmbeddingProvider, sortThreadByEmbedding } from "@amarnai/ai";
import type { EmbeddableNode } from "@amarnai/ai";
import { mockClassify } from "../services/mock-classifier.js";
import { getAIProviderConfig, getEmbeddingProviderConfig } from "../services/ai-providers.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const classify = new Hono();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/ai-classify ─────────

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

    // Build providers early so we return 400 before DB queries if misconfigured
    let provider: ReturnType<typeof createAIProvider>;
    let embeddingProvider: ReturnType<typeof createEmbeddingProvider>;
    try {
      provider = createAIProvider(getAIProviderConfig());
      embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }

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
            receivedAt: true,
          },
        },
      },
    });
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const [rawNodes, rawEdges] = await Promise.all([
      db.taxonomyNode.findMany({
        where: { workspaceId },
        select: {
          id: true,
          name: true,
          description: true,
          instructions: true,
          examples: true,
          isRoot: true,
          embeddingVector: true,
          embeddingModel: true,
          embeddingTextHash: true,
        },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: { id: true, sourceNodeId: true, targetNodeId: true },
      }),
    ]);

    if (rawNodes.length === 0) {
      return c.json({ error: "No taxonomy nodes found for classification" }, 422);
    }

    const nodes: EmbeddableNode[] = rawNodes.map((n: (typeof rawNodes)[number]) => ({
      ...n,
      examples: n.examples as string[],
      embeddingVector: n.embeddingVector.length > 0 ? n.embeddingVector : null,
    }));

    const result = await sortThreadByEmbedding(
      embeddingProvider,
      provider,
      nodes,
      rawEdges,
      thread.messages
    );

    // Persist updated node embeddings (cache for future calls)
    if (result.updatedNodeEmbeddings.length > 0) {
      await Promise.all(
        result.updatedNodeEmbeddings.map((e) =>
          db.taxonomyNode.update({
            where: { id: e.nodeId },
            data: {
              embeddingVector: e.embeddingVector,
              embeddingModel: e.embeddingModel,
              embeddingTextHash: e.embeddingTextHash,
              embeddingUpdatedAt: e.embeddingUpdatedAt,
            },
          })
        )
      );
    }

    const classification = await db.emailClassification.create({
      data: {
        workspaceId,
        emailThreadId: threadId,
        finalNodeId: result.finalNodeId,
        confidence: result.confidence,
        explanation: result.explanation,
        needsHumanReview: result.needsHumanReview,
        modelProvider: provider.providerName,
        modelName: provider.modelName,
      },
      select: { id: true },
    });

    // Update triage status to reflect the latest classification outcome
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
          needsHumanReview: result.needsHumanReview,
          decisionSource: result.decisionSource,
          modelProvider: provider.providerName,
          modelName: provider.modelName,
        },
      },
      201
    );
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
