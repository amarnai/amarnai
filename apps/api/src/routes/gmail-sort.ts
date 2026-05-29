import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { createAIProvider, createEmbeddingProvider, sortThreadByEmbedding, snapshotToThreadMessages } from "@amarnai/ai";
import type { EmbeddableNode } from "@amarnai/ai";
import { GmailClient } from "../services/gmail-client.js";
import { normalizeGmailThread } from "../services/gmail-thread-adapter.js";
import { getAIProviderConfig, getEmbeddingProviderConfig } from "../services/ai-providers.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const sortBodySchema = z.object({
  gmailThreadId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid Gmail thread ID format"),
});

function isDevEnabled(): boolean {
  return (
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_DEV_TOOLS"] === "true"
  );
}

const gmailSort = new Hono();

// ─── POST /dev/workspaces/:workspaceId/gmail-sort-thread ───────────────────────

gmailSort.post("/dev/workspaces/:workspaceId/gmail-sort-thread", async (c) => {
  if (!isDevEnabled()) return c.json({ error: "Not found" }, 404);

  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const body = sortBodySchema.safeParse(rawBody);
  if (!body.success) {
    return c.json({ error: "Validation error", issues: body.error.issues }, 400);
  }

  const { workspaceId } = params.data;
  const { gmailThreadId } = body.data;

  // ── 1. Verify workspace + connection ──────────────────────────────────────

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerUserId: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      gmailAddress: true,
      googleSubjectId: true,
      encryptedRefreshToken: true,
    },
  });
  if (!connection) {
    return c.json({ error: "No Gmail inbox connected to this workspace" }, 422);
  }

  // ── 2. Fetch + normalize Gmail thread ─────────────────────────────────────

  const client = new GmailClient(connection.encryptedRefreshToken);
  let rawThread: unknown;
  try {
    rawThread = await client.getThread(gmailThreadId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) return c.json({ error: "Gmail thread not found" }, 404);
    return c.json({ error: "Failed to fetch Gmail thread" }, 502);
  }

  const snapshot = normalizeGmailThread(rawThread);

  if (snapshot.messages.length === 0) {
    return c.json({ error: "Gmail thread has no messages" }, 422);
  }

  // ── 3. Find or create EmailAccount for this connection ────────────────────

  const providerAccountId = connection.googleSubjectId ?? connection.gmailAddress;
  const emailAccount = await db.emailAccount.upsert({
    where: {
      workspaceId_providerAccountId: { workspaceId, providerAccountId },
    },
    create: {
      workspaceId,
      userId: workspace.ownerUserId,
      provider: "GMAIL",
      primaryEmailAddress: connection.gmailAddress,
      providerAccountId,
      accessTokenEncrypted: "placeholder",
      refreshTokenEncrypted: connection.encryptedRefreshToken,
    },
    update: {},
    select: { id: true },
  });

  // ── 4. Upsert EmailThread ──────────────────────────────────────────────────

  const emailThread = await db.emailThread.upsert({
    where: {
      emailAccountId_providerThreadId: {
        emailAccountId: emailAccount.id,
        providerThreadId: snapshot.providerThreadId,
      },
    },
    create: {
      workspaceId,
      emailAccountId: emailAccount.id,
      provider: "GMAIL",
      providerThreadId: snapshot.providerThreadId,
      subject: snapshot.subject,
      latestMessageAt: snapshot.latestMessageAt,
      messageCount: snapshot.messageCount,
    },
    update: {
      subject: snapshot.subject,
      latestMessageAt: snapshot.latestMessageAt,
      messageCount: snapshot.messageCount,
    },
    select: { id: true },
  });

  // ── 5. Upsert EmailMessages (metadata only — no body text persisted) ───────

  for (const msg of snapshot.messages) {
    const snippet = msg.bodyExcerpt ? msg.bodyExcerpt.slice(0, 200) : null;
    await db.emailMessage.upsert({
      where: {
        emailAccountId_providerMessageId: {
          emailAccountId: emailAccount.id,
          providerMessageId: msg.providerMessageId,
        },
      },
      create: {
        workspaceId,
        emailAccountId: emailAccount.id,
        emailThreadId: emailThread.id,
        providerMessageId: msg.providerMessageId,
        senderEmail: msg.senderEmail,
        senderName: msg.senderName,
        toEmails: msg.toEmails,
        ccEmails: msg.ccEmails,
        bccEmails: [],
        subject: msg.subject,
        snippet,
        bodyText: null,
        receivedAt: msg.receivedAt,
        hasAttachments: msg.attachments.length > 0,
      },
      update: {
        senderName: msg.senderName,
        snippet,
        hasAttachments: msg.attachments.length > 0,
      },
      select: { id: true },
    });
  }

  // ── 6. Taxonomy ───────────────────────────────────────────────────────────

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

  // ── 7. Classify ───────────────────────────────────────────────────────────

  let provider: ReturnType<typeof createAIProvider>;
  let embeddingProvider: ReturnType<typeof createEmbeddingProvider>;
  try {
    provider = createAIProvider(getAIProviderConfig());
    embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const messages = snapshotToThreadMessages(snapshot);
  const result = await sortThreadByEmbedding(embeddingProvider, provider, nodes, rawEdges, messages);

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

  // ── 8. Persist classification ─────────────────────────────────────────────

  const classification = await db.emailClassification.create({
    data: {
      workspaceId,
      emailThreadId: emailThread.id,
      finalNodeId: result.finalNodeId,
      confidence: result.confidence,
      explanation: result.explanation,
      needsHumanReview: result.needsHumanReview,
      decisionSource: result.decisionSource,
      modelProvider: provider.providerName,
      modelName: provider.modelName,
    },
    select: { id: true },
  });

  await db.emailThread.update({
    where: { id: emailThread.id },
    data: { triageStatus: result.needsHumanReview ? "NEEDS_REVIEW" : "SORTED" },
  });

  // ── 9. Resolve final node name ────────────────────────────────────────────

  const finalNodeName = result.finalNodeId
    ? (rawNodes.find((n: (typeof rawNodes)[number]) => n.id === result.finalNodeId)?.name ?? null)
    : null;

  // Build nodeId → name map for debug display
  const nodeNames: Record<string, string> = {};
  for (const n of rawNodes) {
    nodeNames[n.id] = n.name;
  }

  return c.json(
    {
      snapshot: {
        providerThreadId: snapshot.providerThreadId,
        subject: snapshot.subject,
        messageCount: snapshot.messageCount,
        latestMessageAt: snapshot.latestMessageAt.toISOString(),
        participants: snapshot.participants,
      },
      classification: {
        id: classification.id,
        finalNodeId: result.finalNodeId,
        finalNodeName,
        confidence: result.confidence,
        explanation: result.explanation,
        needsHumanReview: result.needsHumanReview,
        decisionSource: result.decisionSource,
        modelProvider: provider.providerName,
        modelName: provider.modelName,
      },
      debug: {
        path: result.path,
        rawSimilarities: result.rawSimilarities,
        subtreeScores: result.subtreeScores,
        nodeNames,
        updatedEmbeddingsCount: result.updatedNodeEmbeddings.length,
      },
    },
    201
  );
});

// ─── GET /dev/workspaces/:workspaceId/gmail-recent-threads ─────────────────────

gmailSort.get("/dev/workspaces/:workspaceId/gmail-recent-threads", async (c) => {
  if (!isDevEnabled()) return c.json({ error: "Not found" }, 404);

  const params = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!params.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = params.data;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const connection = await db.gmailConnection.findUnique({
    where: { workspaceId },
    select: { encryptedRefreshToken: true },
  });
  if (!connection) {
    return c.json({ error: "No Gmail inbox connected to this workspace" }, 422);
  }

  const client = new GmailClient(connection.encryptedRefreshToken);
  let threads: Array<{ id: string; subject: string | null }>;
  try {
    threads = await client.listRecentThreads(5);
  } catch (err) {
    console.error("[gmail-recent-threads] Failed:", err);
    return c.json({ error: "Failed to list recent Gmail threads" }, 502);
  }

  return c.json({ threads });
});

export { gmailSort as gmailSortRoute };
