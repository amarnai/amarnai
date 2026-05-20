import { Hono } from "hono";
import { z } from "zod";
import { db, Prisma } from "@amarnai/db";
import { createAIProvider, classifyThread } from "@amarnai/ai";
import { mockClassify } from "../services/mock-classifier.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

function getAIProviderConfig() {
  const cfg: import("@amarnai/ai").AIProviderConfig = {
    provider: (process.env["AI_PROVIDER"] ?? "mock") as "mock" | "ollama" | "frontier",
  };
  const ollamaBase = process.env["OLLAMA_BASE_URL"];
  const ollamaModel = process.env["OLLAMA_MODEL"];
  if (ollamaBase ?? ollamaModel) {
    cfg.ollama = {
      ...(ollamaBase ? { baseUrl: ollamaBase } : {}),
      ...(ollamaModel ? { model: ollamaModel } : {}),
    };
  }
  const fProvider = process.env["FRONTIER_LLM_PROVIDER"];
  const fApiKey = process.env["FRONTIER_LLM_API_KEY"];
  const fModel = process.env["FRONTIER_LLM_MODEL"];
  const fBaseUrl = process.env["FRONTIER_LLM_BASE_URL"];
  if (fProvider ?? fApiKey ?? fModel ?? fBaseUrl) {
    cfg.frontier = {
      ...(fProvider ? { provider: fProvider } : {}),
      ...(fApiKey ? { apiKey: fApiKey } : {}),
      ...(fModel ? { model: fModel } : {}),
      ...(fBaseUrl ? { baseUrl: fBaseUrl } : {}),
    };
  }
  return cfg;
}

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

    // Build provider early so we return 400 before DB queries if misconfigured
    let provider: ReturnType<typeof createAIProvider>;
    try {
      provider = createAIProvider(getAIProviderConfig());
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
          isVisibleCategory: true,
          canReceiveEmails: true,
        },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          sortingQuestion: true,
          examples: true,
          negativeExamples: true,
        },
      }),
    ]);

    if (rawNodes.length === 0) {
      return c.json({ error: "No taxonomy nodes found for classification" }, 422);
    }

    const nodes = rawNodes.map((n) => ({ ...n, examples: n.examples as string[] }));
    const edges = rawEdges.map((e) => ({
      ...e,
      examples: e.examples as string[],
      negativeExamples: e.negativeExamples as string[],
    }));

    const result = await classifyThread(provider, {
      nodes,
      edges,
      messages: thread.messages,
    });

    const classification = await db.emailClassification.create({
      data: {
        workspaceId,
        emailThreadId: threadId,
        finalNodeId: result.finalNodeId,
        path: result.path as unknown as Prisma.InputJsonValue,
        confidence: result.confidence,
        explanation: result.explanation,
        priority: result.priority,
        urgency: result.urgency,
        riskLevel: result.riskLevel,
        requiredAction: result.requiredAction,
        sensitivity: result.sensitivity,
        dueAt: result.dueAt ? new Date(result.dueAt) : null,
        suggestedNextStep: result.suggestedNextStep,
        needsHumanReview: result.needsHumanReview,
        modelProvider: provider.providerName,
        modelName: provider.modelName,
      },
      select: { id: true },
    });

    let reviewItemId: string | null = null;
    if (result.needsHumanReview) {
      const reviewItem = await db.reviewItem.create({
        data: {
          workspaceId,
          emailThreadId: threadId,
          classificationId: classification.id,
          reason: result.finalNodeId === null
            ? `AI classification could not determine a destination: ${result.explanation}`
            : `Low-confidence AI classification (${Math.round(result.confidence * 100)}%). Manual review required.`,
        },
        select: { id: true },
      });
      reviewItemId = reviewItem.id;
    }

    return c.json(
      {
        classification: {
          id: classification.id,
          finalNodeId: result.finalNodeId,
          path: result.path,
          confidence: result.confidence,
          explanation: result.explanation,
          priority: result.priority,
          urgency: result.urgency,
          riskLevel: result.riskLevel,
          requiredAction: result.requiredAction,
          sensitivity: result.sensitivity,
          dueAt: result.dueAt,
          suggestedNextStep: result.suggestedNextStep,
          needsHumanReview: result.needsHumanReview,
          modelProvider: provider.providerName,
          modelName: provider.modelName,
        },
        reviewItemCreated: reviewItemId !== null,
        reviewItemId,
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

    const [nodes, rawMockEdges] = await Promise.all([
      db.taxonomyNode.findMany({
        where: { workspaceId },
        select: { id: true, name: true, isRoot: true, isVisibleCategory: true, canReceiveEmails: true },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: { id: true, sourceNodeId: true, targetNodeId: true, sortingQuestion: true },
      }),
    ]);

    if (nodes.length === 0) {
      return c.json({ error: "No taxonomy nodes found for classification" }, 422);
    }

    const result = mockClassify(thread.messages, nodes, rawMockEdges);

    const classification = await db.emailClassification.create({
      data: {
        workspaceId,
        emailThreadId: threadId,
        finalNodeId: result.finalNodeId,
        path: result.path as unknown as Prisma.InputJsonValue,
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

    let reviewItemId: string | null = null;
    if (result.needsHumanReview) {
      const reviewItem = await db.reviewItem.create({
        data: {
          workspaceId,
          emailThreadId: threadId,
          classificationId: classification.id,
          reason: `Low confidence classification (${Math.round(result.confidence * 100)}%). Manual review required.`,
        },
        select: { id: true },
      });
      reviewItemId = reviewItem.id;
    }

    return c.json(
      {
        classification: {
          id: classification.id,
          finalNodeId: result.finalNodeId,
          path: result.path,
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
        reviewItemCreated: reviewItemId !== null,
        reviewItemId,
      },
      201
    );
  }
);

export { classify as classifyRoute };
