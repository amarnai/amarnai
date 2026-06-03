import { Hono } from "hono";
import { z } from "zod";
import { db, Prisma } from "@amarnai/db";
import { createAIProvider, generateDraft, getAIProviderConfig } from "@amarnai/ai";
import { getDraftLimit, getDraftQuotaWindowStart, getDraftQuotaResetsAt, getThreadSortLimit } from "@amarnai/shared";
import { config } from "@amarnai/config";
import { GmailClient, normalizeGmailThread } from "@amarnai/gmail";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const draftParams = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
  draftId: z.string().min(1),
});

const drafts = new Hono();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/generate-draft ──────
//
// Synchronous: loads thread messages + latest classification, calls the LLM,
// persists a PROPOSED Draft row, and returns the draft inline. Returns 422 if
// the thread has not been classified yet, or 503 if no AI provider is configured.
//
// A GENERATING placeholder row is created inside a locked transaction so that:
//   1. Concurrent requests for the same workspace serialize on the quota check —
//      preventing TOCTOU races where two requests both read "quota OK" before
//      either has committed a placeholder.
//   2. If the client disconnects (e.g. page refresh), the GENERATING row survives
//      so the thread list can expose isDrafting and the UI can poll.
//
// Quota enforcement:
//   Drafts with status PROPOSED, SENT, CREATED_IN_GMAIL, or non-stale GENERATING
//   count against the monthly quota. FAILED rows are excluded — server errors
//   should not burn the user's allowance. Stale GENERATING rows (server crash
//   recovery) are similarly excluded after DRAFT_GENERATING_STALE_MS.

const DRAFT_GENERATING_STALE_MS = 5 * 60 * 1_000;

// Statuses that represent a completed or in-progress generation and count toward quota.
// Raw SQL fragment — keep in sync with DraftStatus enum in schema.prisma.
const QUOTA_COUNTED_STATUSES = `('PROPOSED', 'SENT', 'CREATED_IN_GMAIL', 'GENERATING')`;

drafts.post(
  "/workspaces/:workspaceId/email-threads/:threadId/generate-draft",
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
        subject: true,
        providerThreadId: true,
        messages: {
          orderBy: { receivedAt: "asc" },
          select: {
            providerMessageId: true,
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
    if (thread.messages.length === 0) {
      return c.json({ error: "Thread has no messages" }, 422);
    }

    const classification = await db.emailClassification.findFirst({
      where: { emailThreadId: threadId, workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        requiredAction: true,
        suggestedNextStep: true,
        explanation: true,
        finalNode: { select: { name: true } },
      },
    });
    if (!classification) {
      return c.json(
        { error: "Thread has not been classified yet — sort the thread before generating a draft" },
        422
      );
    }

    const gmailConnection = await db.gmailConnection.findUnique({
      where: { workspaceId },
      select: { gmailAddress: true, encryptedRefreshToken: true },
    });

    // ── Stale threshold shared by the quick check and the transaction ─────────
    const staleThreshold = new Date(Date.now() - DRAFT_GENERATING_STALE_MS);

    // ── Quick check outside the lock ──────────────────────────────────────────
    // For the common case of re-fetching an already-generated draft, avoid
    // acquiring a row lock altogether.
    const existingDraft = await db.draft.findFirst({
      where: {
        emailThreadId: threadId,
        workspaceId,
        status: { in: ["GENERATING", "PROPOSED"] },
        OR: [{ status: "PROPOSED" }, { createdAt: { gt: staleThreshold } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, body: true, status: true, createdAt: true },
    });
    if (existingDraft?.status === "GENERATING") {
      return c.json({ generating: true }, 202);
    }
    if (existingDraft?.status === "PROPOSED") {
      return c.json({ draft: existingDraft }, 200);
    }

    // Fetch workspace plan before the transaction so the lock duration stays short.
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    });
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    let provider;
    try {
      provider = createAIProvider(getAIProviderConfig());
    } catch (e) {
      return c.json({ error: `AI provider not configured: ${String(e)}` }, 503);
    }

    // ── Atomic quota check + placeholder creation ─────────────────────────────
    // SELECT FOR UPDATE on the Workspace row serializes concurrent generate
    // requests for the same workspace. This prevents two simultaneous requests
    // from both passing the quota check before either has inserted a placeholder.
    //
    // The re-check for an existing draft under the lock closes the race between
    // the quick check above and now.
    type TxResult =
      | { kind: "placeholder"; placeholder: { id: string } }
      | { kind: "existing_generating" }
      | { kind: "existing_proposed"; draft: { id: string; subject: string | null; body: string; status: string; createdAt: Date } }
      | { kind: "quota_exceeded"; used: number; limit: number; resetsAt: Date };

    const txResult = await db.$transaction(async (tx): Promise<TxResult> => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;

      // Re-check under lock.
      const existingUnderLock = await tx.draft.findFirst({
        where: {
          emailThreadId: threadId,
          workspaceId,
          status: { in: ["GENERATING", "PROPOSED"] },
          OR: [{ status: "PROPOSED" }, { createdAt: { gt: staleThreshold } }],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, subject: true, body: true, status: true, createdAt: true },
      });
      if (existingUnderLock?.status === "GENERATING") return { kind: "existing_generating" };
      if (existingUnderLock?.status === "PROPOSED") return { kind: "existing_proposed", draft: existingUnderLock };

      if (config.billing.enforceDraftQuota) {
        const now = new Date();
        const windowStart = getDraftQuotaWindowStart(now);
        const limit = getDraftLimit(workspace.plan);

        // Count non-FAILED drafts in the current calendar-month window.
        // Stale GENERATING rows (server crashes) are excluded so a crash does
        // not permanently burn the user's allowance.
        const [{ count }] = await tx.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) AS count FROM "Draft"
          WHERE "workspaceId" = ${workspaceId}
            AND "createdAt" >= ${windowStart}
            AND status IN ${Prisma.raw(QUOTA_COUNTED_STATUSES)}
            AND NOT (status = 'GENERATING' AND "createdAt" <= ${staleThreshold})
        `;

        if (Number(count) >= limit) {
          return {
            kind: "quota_exceeded",
            used: Number(count),
            limit,
            resetsAt: getDraftQuotaResetsAt(now),
          };
        }
      }

      const placeholder = await tx.draft.create({
        data: {
          workspaceId,
          emailThreadId: threadId,
          classificationId: classification.id,
          subject: thread.subject ? `Re: ${thread.subject}` : "",
          body: "",
          status: "GENERATING",
        },
        select: { id: true },
      });

      return { kind: "placeholder", placeholder };
    });

    if (txResult.kind === "existing_generating") {
      return c.json({ generating: true }, 202);
    }
    if (txResult.kind === "existing_proposed") {
      return c.json({ draft: txResult.draft }, 200);
    }
    if (txResult.kind === "quota_exceeded") {
      return c.json(
        {
          error: "Monthly draft quota exceeded",
          used: txResult.used,
          limit: txResult.limit,
          resetsAt: txResult.resetsAt.toISOString(),
        },
        429
      );
    }

    const { placeholder } = txResult;

    // Fetch full body texts from Gmail (one call for all messages in the thread).
    // Falls back to DB bodyText for mock inbox (no Gmail connection) or on error.
    let messagesForDraft = thread.messages.map(({ providerMessageId: _pmid, ...m }) => m);
    if (gmailConnection?.encryptedRefreshToken) {
      try {
        const client = new GmailClient(gmailConnection.encryptedRefreshToken);
        const rawThread = await client.getThread(thread.providerThreadId);
        const snapshot = normalizeGmailThread(rawThread);
        const bodyByMessageId = new Map(
          snapshot.messages.map((m) => [m.providerMessageId, m.bodyExcerpt])
        );
        messagesForDraft = thread.messages.map(({ providerMessageId, ...m }) => ({
          ...m,
          bodyText: bodyByMessageId.get(providerMessageId) ?? m.bodyText,
        }));
      } catch {
        // Non-fatal: fall back to DB values
      }
    }

    let result;
    try {
      result = await generateDraft(provider, messagesForDraft, {
        requiredAction: classification.requiredAction ?? null,
        suggestedNextStep: classification.suggestedNextStep ?? null,
        explanation: classification.explanation ?? null,
        finalNodeName: classification.finalNode?.name ?? null,
        senderEmail: gmailConnection?.gmailAddress ?? null,
      });
    } catch (e) {
      await db.draft.update({
        where: { id: placeholder.id },
        data: { status: "FAILED", errorMessage: String(e) },
      });
      return c.json({ error: "Draft generation failed" }, 500);
    }

    if (!result) {
      await db.draft.update({
        where: { id: placeholder.id },
        data: { status: "FAILED", errorMessage: "LLM returned invalid output" },
      });
      return c.json({ error: "Draft generation failed — LLM returned invalid output" }, 500);
    }

    const subject = result.subject || (thread.subject ? `Re: ${thread.subject}` : "");

    const draft = await db.draft.update({
      where: { id: placeholder.id },
      data: { status: "PROPOSED", subject, body: result.body },
      select: { id: true, subject: true, body: true, status: true, createdAt: true },
    });

    console.log(`[drafts] Generated draft ${draft.id} for thread ${threadId}`);
    return c.json({ draft }, 201);
  }
);

// ─── GET /workspaces/:workspaceId/draft-quota ──────────────────────────────────
//
// Returns the workspace's current draft usage for the active calendar-month window:
//   { used, limit, resetsAt }
// No lock is needed — this is a point-in-time read for display purposes only.

drafts.get(
  "/workspaces/:workspaceId/draft-quota",
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) {
      return c.json({ error: "Invalid params" }, 400);
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    });
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const now = new Date();
    const windowStart = getDraftQuotaWindowStart(now);
    const staleThreshold = new Date(now.getTime() - DRAFT_GENERATING_STALE_MS);
    const limit = getDraftLimit(workspace.plan);

    const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM "Draft"
      WHERE "workspaceId" = ${workspaceId}
        AND "createdAt" >= ${windowStart}
        AND status IN ${Prisma.raw(QUOTA_COUNTED_STATUSES)}
        AND NOT (status = 'GENERATING' AND "createdAt" <= ${staleThreshold})
    `;

    return c.json({
      used: Number(count),
      limit,
      resetsAt: getDraftQuotaResetsAt(now).toISOString(),
    });
  }
);

// ─── GET /workspaces/:workspaceId/thread-sort-quota ───────────────────────────
//
// Returns the workspace's current thread-sort usage for the active calendar-month
// window: { used, limit, resetsAt }
// "used" counts distinct email threads classified this month.

drafts.get(
  "/workspaces/:workspaceId/thread-sort-quota",
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) {
      return c.json({ error: "Invalid params" }, 400);
    }

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    });
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const now = new Date();
    const windowStart = getDraftQuotaWindowStart(now);
    const limit = getThreadSortLimit(workspace.plan);

    const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "emailThreadId") AS count FROM "EmailClassification"
      WHERE "workspaceId" = ${workspaceId}
        AND "createdAt" >= ${windowStart}
    `;

    return c.json({
      used: Number(count),
      limit,
      resetsAt: getDraftQuotaResetsAt(now).toISOString(),
    });
  }
);

// ─── GET /workspaces/:workspaceId/email-threads/:threadId/drafts ───────────────
//
// Returns PROPOSED drafts for the thread, newest first. Used by the UI to restore
// the most recent draft when re-selecting a thread.

drafts.get(
  "/workspaces/:workspaceId/email-threads/:threadId/drafts",
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

    const list = await db.draft.findMany({
      where: { emailThreadId: threadId, workspaceId, status: { in: ["GENERATING", "PROPOSED", "SENT"] as ("GENERATING" | "PROPOSED" | "SENT")[] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, body: true, status: true, createdAt: true },
    });

    return c.json({ drafts: list });
  }
);

// ─── PATCH /workspaces/:workspaceId/email-threads/:threadId/drafts/:draftId ───
//
// Toggles the draft between PROPOSED and SENT. The "draft" pill in the thread
// list reflects PROPOSED only; SENT keeps the card visible without the pill.

drafts.patch(
  "/workspaces/:workspaceId/email-threads/:threadId/drafts/:draftId",
  async (c) => {
    const parsed = draftParams.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
      draftId: c.req.param("draftId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId, draftId } = parsed.data;

    const body = await c.req.json<{ status: string }>().catch(() => ({})) as { status?: string };
    if (body.status !== "SENT" && body.status !== "PROPOSED") {
      return c.json({ error: "status must be SENT or PROPOSED" }, 400);
    }
    const newStatus = body.status;

    const current = await db.draft.findFirst({
      where: { id: draftId, emailThreadId: threadId, workspaceId },
      select: { id: true, status: true },
    });
    if (!current) {
      return c.json({ error: "Draft not found" }, 404);
    }
    if (current.status !== "PROPOSED" && current.status !== "SENT") {
      return c.json({ error: "Draft cannot be toggled in its current status" }, 409);
    }

    const updated = await db.draft.update({
      where: { id: draftId },
      data: { status: newStatus },
      select: { id: true, subject: true, body: true, status: true, createdAt: true },
    });

    return c.json({ draft: updated });
  }
);

// ─── DELETE /workspaces/:workspaceId/email-threads/:threadId/drafts/:draftId ──
//
// Marks the draft as CREATED_IN_GMAIL (user sent the reply). The draft is
// excluded from future PROPOSED queries and the thread row indicator clears.

drafts.delete(
  "/workspaces/:workspaceId/email-threads/:threadId/drafts/:draftId",
  async (c) => {
    const parsed = draftParams.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
      draftId: c.req.param("draftId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId, draftId } = parsed.data;

    const updated = await db.draft.updateMany({
      where: { id: draftId, emailThreadId: threadId, workspaceId, status: "PROPOSED" },
      data: { status: "CREATED_IN_GMAIL" },
    });

    if (updated.count === 0) {
      return c.json({ error: "Draft not found" }, 404);
    }

    return c.json({ ok: true });
  }
);

export { drafts as draftsRoute };
