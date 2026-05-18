import { Hono } from "hono";
import { z } from "zod";
import { db, Prisma } from "@genizor/db";
import { mockClassify } from "../services/mock-classifier.js";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new_thread"),
    subject: z.string().max(500).optional(),
    senderName: z.string().max(200).optional(),
    senderEmail: z.string().email(),
    bodyText: z.string().min(1).max(10000),
  }),
  z.object({
    mode: z.literal("existing_thread"),
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
        select: { id: true, name: true, isRoot: true, canReceiveEmails: true },
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

  const nodes = workspace.taxonomyNodes;
  if (nodes.length === 0) {
    return c.json({ error: "No taxonomy nodes found for classification" }, 422);
  }

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
    select: { subject: true, senderEmail: true, senderName: true, bodyText: true },
    orderBy: { receivedAt: "asc" },
  });

  const latestThread = await db.emailThread.findUniqueOrThrow({
    where: { id: threadId },
    select: { id: true, subject: true, messageCount: true, latestMessageAt: true },
  });

  const result = mockClassify(allMessages, nodes);

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
      thread: {
        id: latestThread.id,
        subject: latestThread.subject,
        messageCount: latestThread.messageCount,
        isNew: isNewThread,
      },
      classification: {
        id: classification.id,
        finalNode: { id: result.finalNodeId, name: result.finalNodeName },
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
      },
      reviewItemCreated: reviewItemId !== null,
      reviewItemId,
    },
    201
  );
});

export { mockInbox as mockInboxRoute };
