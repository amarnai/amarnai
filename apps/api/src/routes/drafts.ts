import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";
import { createAIProvider, generateDraft } from "@amarnai/ai";
import { getAIProviderConfig } from "../services/ai-providers.js";

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
// A GENERATING placeholder row is created before the LLM call so that if the
// client disconnects (e.g. page refresh), the thread list can expose isDrafting
// and the UI can poll until the draft becomes PROPOSED.

const DRAFT_GENERATING_STALE_MS = 5 * 60 * 1_000;

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
      select: { gmailAddress: true },
    });

    // Return an existing proposed draft without re-generating.
    // Ignore GENERATING drafts older than the stale threshold (server crash recovery).
    const staleThreshold = new Date(Date.now() - DRAFT_GENERATING_STALE_MS);
    const existingDraft = await db.draft.findFirst({
      where: {
        emailThreadId: threadId,
        workspaceId,
        status: { in: ["GENERATING", "PROPOSED"] as ("GENERATING" | "PROPOSED")[] },
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

    let provider;
    try {
      provider = createAIProvider(getAIProviderConfig());
    } catch (e) {
      return c.json({ error: `AI provider not configured: ${String(e)}` }, 503);
    }

    // Create a GENERATING placeholder so the status survives a page refresh.
    const placeholder = await db.draft.create({
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

    let result;
    try {
      result = await generateDraft(provider, thread.messages, {
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
