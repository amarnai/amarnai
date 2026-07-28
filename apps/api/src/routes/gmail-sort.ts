import { Hono } from "hono";
import { z } from "zod";
import { db, resolveInboxQuota, recordMeterUsage, inboxKeyFor, meterWindowStart, threadSortDedupToken } from "@amarnai/db";
import { createAIProvider, createEmbeddingProvider, sortThreadByEmbedding, snapshotToThreadMessages, getAIProviderConfig, getEmbeddingProviderConfig, isDraftMessage } from "@amarnai/ai";
import type { EmbeddableNode } from "@amarnai/ai";
import { getThreadSortLimit, getDraftQuotaResetsAt } from "@amarnai/shared";
import { config } from "@amarnai/config";
import { createMailProvider, MailThreadNotFoundError } from "@amarnai/mail";
import { DEDUP_WRITEBACK } from "@amarnai/queue";
import { writebackThreadLabelQueue } from "../queues.js";
// GmailClient is retained only for the Gmail-specific dev endpoint below
// (listRecentThreads is a debug convenience, not part of the neutral seam).
import { GmailClient } from "../services/gmail-client.js";

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

  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      provider: true,
      emailAddress: true,
      subjectId: true,
      encryptedRefreshToken: true,
    },
  });
  if (!connection) {
    return c.json({ error: "No Gmail inbox connected to this workspace" }, 422);
  }

  // ── 1a. Monthly thread-sort quota ─────────────────────────────────────────
  //
  // This synchronous sort runs a real embedding/LLM, so it is metered like any
  // recurring sort. Checked before the Gmail fetch + AI call to avoid wasted
  // work when over limit. Gated against the SAME reset-immune, inbox-pooled
  // meter the classify worker accounts + gates on (resolveInboxQuota →
  // InboxUsageMeter), sized by the top plan among workspaces sharing this inbox.
  // A disconnect+reconnect (resetWorkspaceData) wipes EmailClassification rows
  // but never the meter, so it cannot refund quota. Gated by
  // enforceThreadSortQuota for self-host/dev.
  if (config.billing.enforceThreadSortQuota) {
    const now = new Date();
    const { plan, used } = await resolveInboxQuota(connection.emailAddress, "THREAD_SORT", now);
    const limit = getThreadSortLimit(plan);
    if (used >= limit) {
      return c.json(
        {
          error: "Monthly thread-sort quota exceeded",
          used,
          limit,
          resetsAt: getDraftQuotaResetsAt(now).toISOString(),
        },
        429
      );
    }
  }

  // ── 2. Fetch + normalize thread ───────────────────────────────────────────

  const client = createMailProvider(connection);
  let snapshot: Awaited<ReturnType<typeof client.getThreadSnapshot>>;
  try {
    snapshot = await client.getThreadSnapshot(gmailThreadId);
  } catch (err) {
    // Only the typed provider not-found is a 404; transient errors (which may
    // contain "not found" in their message) surface as 502 so the client retries.
    if (err instanceof MailThreadNotFoundError) {
      return c.json({ error: "Gmail thread not found" }, 404);
    }
    return c.json({ error: "Failed to fetch Gmail thread" }, 502);
  }

  // Drop unsent drafts, matching the worker's ingest filter: a draft is not part
  // of the conversation and must not be persisted or sorted on. messageCount and
  // latestMessageAt are recomputed from what remains.
  const realMessages = snapshot.messages.filter((m) => !isDraftMessage(m));
  if (realMessages.length !== snapshot.messages.length) {
    snapshot = {
      ...snapshot,
      messages: realMessages,
      messageCount: realMessages.length,
      latestMessageAt: realMessages.reduce<Date>(
        (acc, m) => (m.receivedAt > acc ? m.receivedAt : acc),
        new Date(0)
      ),
    };
  }

  if (snapshot.messages.length === 0) {
    return c.json({ error: "Gmail thread has no messages" }, 422);
  }

  // ── 3. Find or create EmailAccount for this connection ────────────────────

  const providerAccountId = connection.subjectId ?? connection.emailAddress;
  const emailAccount = await db.emailAccount.upsert({
    where: {
      workspaceId_providerAccountId: { workspaceId, providerAccountId },
    },
    create: {
      workspaceId,
      userId: workspace.ownerUserId,
      provider: connection.provider,
      primaryEmailAddress: connection.emailAddress,
      providerAccountId,
      accessTokenEncrypted: "placeholder",
      refreshTokenEncrypted: "placeholder",
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
      provider: connection.provider,
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
        attachments: msg.attachments.map(({ filename, mimeType }) => ({ filename, mimeType })),
      },
      update: {
        senderName: msg.senderName,
        snippet,
        hasAttachments: msg.attachments.length > 0,
        attachments: msg.attachments.map(({ filename, mimeType }) => ({ filename, mimeType })),
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
  const result = await sortThreadByEmbedding(embeddingProvider, provider, nodes, rawEdges, messages, { scaleInvariant: true });

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

  // ── 8. Persist classification + meter the sort ────────────────────────────
  //
  // Account this synchronous sort against the SAME reset-immune, inbox-pooled
  // meter the gate above reads, so this endpoint's pre-check and accounting
  // share one counter (the invariant this whole change enforces). Unlike the
  // live/backfill flow, this route sorts inline instead of enqueuing the
  // classify worker, so it must record the meter tick itself. Distinct threads
  // per window: a re-sort of a thread already counted this window is not
  // re-charged, mirroring classify-thread. Recorded independent of the enforce
  // flag so self-host still gets usage observability.
  const inboxKey = inboxKeyFor(connection.emailAddress);
  const meterWindow = meterWindowStart();
  const alreadyCountedThisWindow =
    (await db.emailClassification.count({
      where: {
        emailThreadId: emailThread.id,
        source: { notIn: ["BACKFILL", "MOVE", "MIGRATION"] },
        createdAt: { gte: meterWindow },
      },
    })) > 0;

  // Persist the classification row and its meter increment in ONE transaction,
  // exactly as the classify worker does. As two separate awaits, a crash between
  // them left the row committed but the meter unrecorded, and the count-based
  // `alreadyCountedThisWindow` guard then read that row and skipped the meter
  // forever (under-count); two concurrent manual sorts of one thread could also
  // both pass the guard and double-count. The per-thread-per-window dedup token
  // makes the increment idempotent, so even a concurrent duplicate counts once.
  const classification = await db.$transaction(async (tx) => {
    const row = await tx.emailClassification.create({
      data: {
        workspaceId,
        emailThreadId: emailThread.id,
        finalNodeId: result.finalNodeId,
        confidence: result.confidence,
        explanation: result.explanation,
        needsHumanReview: result.needsHumanReview,
        transientFailure:
          result.fallbackCause === "llm_error" || result.fallbackCause === "embedding_failed",
        source: "MANUAL",
        decisionSource: result.decisionSource,
        modelProvider: provider.providerName,
        modelName: provider.modelName,
      },
      select: { id: true },
    });

    if (!alreadyCountedThisWindow) {
      await recordMeterUsage({
        inboxKey,
        kind: "THREAD_SORT",
        windowStart: meterWindow,
        delta: 1,
        dedupToken: threadSortDedupToken(inboxKey, meterWindow, emailThread.id),
        tx,
      });
    }

    return row;
  });

  await db.emailThread.update({
    where: { id: emailThread.id },
    data: { triageStatus: result.needsHumanReview ? "NEEDS_REVIEW" : "SORTED" },
  });

  // Reconcile the thread's Amarnai label/category to its sorted folder (opt-in
  // writeback). Best-effort + deduped; the worker no-ops when writeback is off.
  try {
    await writebackThreadLabelQueue.add(
      "writeback-thread-label",
      { workspaceId, emailThreadId: emailThread.id },
      { deduplication: { id: `${DEDUP_WRITEBACK}_${workspaceId}_${emailThread.id}` } },
    );
  } catch (err) {
    console.error(
      `[gmail-sort] writeback enqueue failed for thread ${emailThread.id}:`,
      err instanceof Error ? err.message : err,
    );
  }

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

  const connection = await db.emailConnection.findUnique({
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
