import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { mockClassify } from "../services/mock-classifier.js";
import type { MockClassificationResult } from "../services/mock-classifier.js";
import {
  createAIProvider,
  createEmbeddingProvider,
  sortThreadByEmbedding,
  selectCandidateNodes,
  buildCandidateNodePrompt,
  validateNodeSelection,
} from "@amarnai/ai";
import type { EmailInput, NodeSelectionContext, EmbeddableNode } from "@amarnai/ai";

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

function getEmbeddingProviderConfig(): import("@amarnai/ai").EmbeddingProviderConfig {
  const provider = (process.env["EMBEDDING_PROVIDER"] ?? "ollama") as "ollama" | "gemini";
  const cfg: import("@amarnai/ai").EmbeddingProviderConfig = { provider };
  const ollamaBase = process.env["OLLAMA_BASE_URL"];
  const ollamaEmbModel = process.env["OLLAMA_EMBEDDING_MODEL"];
  if (ollamaBase ?? ollamaEmbModel) {
    cfg.ollama = {
      ...(ollamaBase ? { baseUrl: ollamaBase } : {}),
      ...(ollamaEmbModel ? { model: ollamaEmbModel } : {}),
    };
  }
  const gApiKey = process.env["GEMINI_EMBEDDING_API_KEY"];
  const gModel = process.env["GEMINI_EMBEDDING_MODEL"];
  if (gApiKey ?? gModel) {
    cfg.gemini = {
      ...(gApiKey ? { apiKey: gApiKey } : {}),
      ...(gModel ? { model: gModel } : {}),
    };
  }
  return cfg;
}

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const classifierSchema = z.enum(["mock", "ai"]).default("mock");

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new_thread"),
    classifier: classifierSchema,
    subject: z.string().max(500).optional(),
    senderName: z.string().max(200).optional(),
    senderEmail: z.string().email(),
    bodyText: z.string().min(1).max(10000),
  }),
  z.object({
    mode: z.literal("existing_thread"),
    classifier: classifierSchema,
    threadId: z.string().min(1),
    senderName: z.string().max(200).optional(),
    senderEmail: z.string().email(),
    bodyText: z.string().min(1).max(10000),
  }),
]);

const mockInbox = new Hono();

mockInbox.post("/dev/workspaces/:workspaceId/mock-inbox-event", async (c) => {
  const isDevEnabled =
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_DEV_TOOLS"] === "true";

  if (!isDevEnabled) {
    return c.json({ error: "Not found" }, 404);
  }

  const params = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const body = bodySchema.safeParse(rawBody);
  if (!body.success) {
    return c.json({ error: "Validation error", issues: body.error.issues }, 400);
  }

  const { workspaceId } = params.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      emailAccounts: { take: 1, select: { id: true } },
      taxonomyNodes: {
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
      },
    },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const emailAccount = workspace.emailAccounts[0];
  if (!emailAccount) {
    return c.json({ error: "No email account found for workspace" }, 422);
  }

  type RawNode = {
    id: string;
    name: string;
    description: string | null;
    instructions: string | null;
    examples: unknown[];
    isRoot: boolean;
    embeddingVector: number[];
    embeddingModel: string | null;
    embeddingTextHash: string | null;
  };

  const rawNodes = workspace.taxonomyNodes as RawNode[];
  const nodes: import("@amarnai/ai").TaxonomyNodeInput[] = rawNodes.map((n) => ({
    id: n.id,
    name: n.name,
    description: n.description,
    instructions: n.instructions,
    examples: n.examples as string[],
    isRoot: n.isRoot,
  }));
  if (nodes.length === 0) {
    return c.json({ error: "No taxonomy nodes found for classification" }, 422);
  }

  const { classifier } = body.data;

  const edges: import("@amarnai/ai").TaxonomyEdgeInput[] = await db.taxonomyEdge.findMany({
    where: { workspaceId },
    select: { id: true, sourceNodeId: true, targetNodeId: true },
  });

  const now = new Date();
  let threadId: string;
  let isNewThread: boolean;

  if (body.data.mode === "new_thread") {
    const thread = await db.emailThread.create({
      data: {
        workspaceId,
        emailAccountId: emailAccount.id,
        provider: "GMAIL",
        providerThreadId: `mock-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subject: body.data.subject ?? null,
        latestMessageAt: now,
        messageCount: 1,
      },
      select: { id: true },
    });
    threadId = thread.id;
    isNewThread = true;

    await db.emailMessage.create({
      data: {
        workspaceId,
        emailAccountId: emailAccount.id,
        emailThreadId: thread.id,
        providerMessageId: `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        senderEmail: body.data.senderEmail,
        senderName: body.data.senderName ?? null,
        toEmails: [],
        ccEmails: [],
        bccEmails: [],
        subject: body.data.subject ?? null,
        snippet: body.data.bodyText.slice(0, 200),
        bodyText: body.data.bodyText,
        receivedAt: now,
      },
    });
  } else {
    const thread = await db.emailThread.findFirst({
      where: { id: body.data.threadId, workspaceId },
      select: { id: true, emailAccountId: true },
    });
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }
    threadId = thread.id;
    isNewThread = false;

    await db.emailMessage.create({
      data: {
        workspaceId,
        emailAccountId: thread.emailAccountId,
        emailThreadId: thread.id,
        providerMessageId: `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        senderEmail: body.data.senderEmail,
        senderName: body.data.senderName ?? null,
        toEmails: [],
        ccEmails: [],
        bccEmails: [],
        snippet: body.data.bodyText.slice(0, 200),
        bodyText: body.data.bodyText,
        receivedAt: now,
      },
    });

    await db.emailThread.update({
      where: { id: thread.id },
      data: { latestMessageAt: now, messageCount: { increment: 1 } },
    });
  }

  const allMessages = await db.emailMessage.findMany({
    where: { emailThreadId: threadId },
    select: { subject: true, senderEmail: true, senderName: true, bodyText: true, receivedAt: true },
    orderBy: { receivedAt: "asc" },
  });

  const latestThread = await db.emailThread.findUniqueOrThrow({
    where: { id: threadId },
    select: { id: true, subject: true, messageCount: true, latestMessageAt: true },
  });

  // ─── Run classification ──────────────────────────────────────────────────────

  type ClassResult = {
    finalNodeId: string | null;
    finalNodeName: string | null;
    confidence: number;
    explanation: string;
    priority?: MockClassificationResult["priority"] | null;
    urgency?: MockClassificationResult["urgency"] | null;
    riskLevel?: MockClassificationResult["riskLevel"] | null;
    requiredAction?: MockClassificationResult["requiredAction"] | null;
    sensitivity?: MockClassificationResult["sensitivity"] | null;
    suggestedNextStep?: MockClassificationResult["suggestedNextStep"] | null;
    needsHumanReview: boolean;
    modelProvider: string;
    modelName: string;
  };

  let result: ClassResult;

  if (classifier === "ai") {
    let aiProvider: ReturnType<typeof createAIProvider>;
    let embeddingProvider: ReturnType<typeof createEmbeddingProvider>;
    try {
      aiProvider = createAIProvider(getAIProviderConfig());
      embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }

    const embeddableNodes: EmbeddableNode[] = rawNodes.map((n) => ({
      id: n.id,
      name: n.name,
      description: n.description,
      instructions: n.instructions,
      examples: n.examples as string[],
      isRoot: n.isRoot,
      embeddingVector: n.embeddingVector.length > 0 ? n.embeddingVector : null,
      embeddingModel: n.embeddingModel,
      embeddingTextHash: n.embeddingTextHash,
    }));

    const aiResult = await sortThreadByEmbedding(embeddingProvider, aiProvider, embeddableNodes, edges, allMessages);

    if (aiResult.updatedNodeEmbeddings.length > 0) {
      await Promise.all(
        aiResult.updatedNodeEmbeddings.map((e) =>
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

    result = {
      finalNodeId: aiResult.finalNodeId,
      finalNodeName: aiResult.finalNodeId
        ? (nodes.find((n) => n.id === aiResult.finalNodeId)?.name ?? null)
        : null,
      confidence: aiResult.confidence,
      explanation: aiResult.explanation,
      needsHumanReview: aiResult.needsHumanReview,
      modelProvider: aiProvider.providerName,
      modelName: aiProvider.modelName,
    };
  } else {
    const mockResult = mockClassify(allMessages, nodes);
    result = {
      finalNodeId: mockResult.finalNodeId,
      finalNodeName: mockResult.finalNodeName,
      confidence: mockResult.confidence,
      explanation: mockResult.explanation,
      priority: mockResult.priority,
      urgency: mockResult.urgency,
      riskLevel: mockResult.riskLevel,
      requiredAction: mockResult.requiredAction,
      sensitivity: mockResult.sensitivity,
      suggestedNextStep: mockResult.suggestedNextStep,
      needsHumanReview: mockResult.needsHumanReview,
      modelProvider: "mock",
      modelName: "mock-classifier-v1",
    };
  }

  const classification = await db.emailClassification.create({
    data: {
      workspaceId,
      emailThreadId: threadId,
      finalNodeId: result.finalNodeId,
      confidence: result.confidence,
      explanation: result.explanation,
      ...(result.priority != null ? { priority: result.priority } : {}),
      ...(result.urgency != null ? { urgency: result.urgency } : {}),
      ...(result.riskLevel != null ? { riskLevel: result.riskLevel } : {}),
      ...(result.requiredAction != null ? { requiredAction: result.requiredAction } : {}),
      ...(result.sensitivity != null ? { sensitivity: result.sensitivity } : {}),
      ...(result.suggestedNextStep != null ? { suggestedNextStep: result.suggestedNextStep } : {}),
      needsHumanReview: result.needsHumanReview,
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      ...(classifier === "mock" ? { promptVersion: "1.0.0" } : {}),
    },
    select: { id: true },
  });

  await db.emailThread.update({
    where: { id: threadId },
    data: { triageStatus: result.needsHumanReview ? "NEEDS_REVIEW" : "SORTED" },
  });

  return c.json(
    {
      thread: {
        id: latestThread.id,
        subject: latestThread.subject,
        messageCount: latestThread.messageCount,
        isNew: isNewThread,
      },
      classification: {
        id: classification.id,
        finalNode: result.finalNodeId
          ? { id: result.finalNodeId, name: result.finalNodeName ?? result.finalNodeId }
          : null,
        confidence: result.confidence,
        explanation: result.explanation,
        priority: result.priority ?? null,
        urgency: result.urgency ?? null,
        riskLevel: result.riskLevel ?? null,
        requiredAction: result.requiredAction ?? null,
        sensitivity: result.sensitivity ?? null,
        suggestedNextStep: result.suggestedNextStep ?? null,
        needsHumanReview: result.needsHumanReview,
        modelProvider: result.modelProvider,
        modelName: result.modelName,
      },
    },
    201
  );
});

const candidateBodySchema = z.object({
  emails: z
    .array(
      z.object({
        subject: z.string().max(500).optional(),
        senderEmail: z.string().optional(),
        senderName: z.string().max(200).optional(),
        bodyText: z.string().max(10000).optional(),
      })
    )
    .min(1)
    .max(20),
  currentNodeId: z.string().optional(),
});

mockInbox.post("/dev/workspaces/:workspaceId/candidate-paths", async (c) => {
  const isDevEnabled =
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_DEV_TOOLS"] === "true";

  if (!isDevEnabled) {
    return c.json({ error: "Not found" }, 404);
  }

  const params = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const body = candidateBodySchema.safeParse(rawBody);
  if (!body.success) {
    return c.json({ error: "Validation error", issues: body.error.issues }, 400);
  }

  const { workspaceId } = params.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      taxonomyNodes: {
        select: {
          id: true,
          name: true,
          description: true,
          instructions: true,
          examples: true,
          isRoot: true,
        },
      },
    },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const edges: import("@amarnai/ai").TaxonomyEdgeInput[] = await db.taxonomyEdge.findMany({
    where: { workspaceId },
    select: { id: true, sourceNodeId: true, targetNodeId: true },
  });

  const nodes: import("@amarnai/ai").TaxonomyNodeInput[] = (
    workspace.taxonomyNodes as Array<{
      id: string;
      name: string;
      description: string | null;
      instructions: string | null;
      examples: unknown[];
      isRoot: boolean;
    }>
  ).map((n) => ({
    id: n.id,
    name: n.name,
    description: n.description,
    instructions: n.instructions,
    examples: n.examples as string[],
    isRoot: n.isRoot,
  }));
  const result = selectCandidateNodes(
    nodes,
    edges,
    body.data.emails as EmailInput[],
    body.data.currentNodeId
  );

  return c.json(result);
});

const llmSelectionBodySchema = z.object({
  emails: z
    .array(
      z.object({
        subject: z.string().max(500).optional(),
        senderEmail: z.string().optional(),
        senderName: z.string().max(200).optional(),
        bodyText: z.string().max(10000).optional(),
      })
    )
    .min(1)
    .max(20),
  currentNodeId: z.string().optional(),
  context: z
    .object({
      timestamp: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

mockInbox.post("/dev/workspaces/:workspaceId/llm-path-selection", async (c) => {
  const isDevEnabled =
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_DEV_TOOLS"] === "true";

  if (!isDevEnabled) {
    return c.json({ error: "Not found" }, 404);
  }

  const params = workspaceParam.safeParse({
    workspaceId: c.req.param("workspaceId"),
  });
  if (!params.success) {
    return c.json({ error: "Invalid workspace ID" }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const body = llmSelectionBodySchema.safeParse(rawBody);
  if (!body.success) {
    return c.json({ error: "Validation error", issues: body.error.issues }, 400);
  }

  const { workspaceId } = params.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      taxonomyNodes: {
        select: {
          id: true,
          name: true,
          description: true,
          instructions: true,
          examples: true,
          isRoot: true,
        },
      },
    },
  });
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const aiEdges: import("@amarnai/ai").TaxonomyEdgeInput[] = await db.taxonomyEdge.findMany({
    where: { workspaceId },
    select: { id: true, sourceNodeId: true, targetNodeId: true },
  });

  const nodes: import("@amarnai/ai").TaxonomyNodeInput[] = (
    workspace.taxonomyNodes as Array<{
      id: string;
      name: string;
      description: string | null;
      instructions: string | null;
      examples: unknown[];
      isRoot: boolean;
    }>
  ).map((n) => ({
    id: n.id,
    name: n.name,
    description: n.description,
    instructions: n.instructions,
    examples: n.examples as string[],
    isRoot: n.isRoot,
  }));

  const candidateResult = selectCandidateNodes(
    nodes,
    aiEdges,
    body.data.emails as EmailInput[],
    body.data.currentNodeId
  );

  if (candidateResult.candidates.length === 0) {
    return c.json({
      candidateResult,
      rawLLMOutput: null,
      result: {
        finalNodeId: null,
        path: [],
        confidence: 0,
        explanation: "No candidate paths found — cannot run LLM selection.",
        needsHumanReview: true,
      },
    });
  }

  let aiProvider: ReturnType<typeof createAIProvider>;
  try {
    aiProvider = createAIProvider(getAIProviderConfig());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const rawContext = body.data.context;
  const context: NodeSelectionContext | undefined =
    rawContext !== undefined
      ? {
          ...(rawContext.timestamp !== undefined ? { timestamp: rawContext.timestamp } : {}),
          ...(rawContext.timezone !== undefined ? { timezone: rawContext.timezone } : {}),
        }
      : undefined;

  const messages = buildCandidateNodePrompt(
    { messages: body.data.emails.map((e) => ({
      subject: e.subject ?? null,
      senderEmail: e.senderEmail ?? "",
      senderName: e.senderName ?? null,
      bodyText: e.bodyText ?? null,
      receivedAt: new Date(),
    })) },
    candidateResult.candidates,
    context
  );

  const rawLLMOutput = await aiProvider.chat(messages);
  const result = validateNodeSelection(rawLLMOutput, candidateResult.candidates);

  // Build debug info for dev: show how selectedNodeId resolved
  let rawSelectedNodeId: string | null = null;
  let resolvedCandidate: import("@amarnai/ai").CandidateNode | undefined;
  try {
    const parsed = JSON.parse(rawLLMOutput.trim()) as Record<string, unknown>;
    if (typeof parsed["selectedNodeId"] === "string") {
      rawSelectedNodeId = parsed["selectedNodeId"];
      const candidateByNodeId = new Map(
        candidateResult.candidates.map((c, i) => [`candidate_${i}`, c])
      );
      resolvedCandidate = candidateByNodeId.get(rawSelectedNodeId);
    }
  } catch {
    // best-effort; ignore parse failures in debug
  }

  const debug = {
    rawSelectedNodeId,
    resolvedNodeId: resolvedCandidate?.nodeId ?? null,
    resolvedBreadcrumb: resolvedCandidate?.breadcrumb ?? null,
    resolvedName: resolvedCandidate?.name ?? null,
  };

  return c.json({ candidateResult, rawLLMOutput, result, debug });
});

export { mockInbox as mockInboxRoute };
