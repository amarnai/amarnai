import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  db,
  getThreadSortUsage,
  resolveInboxQuota,
  meterWindowStart,
  recordMeterUsage,
} from "@amarnai/db";
import { createAIProvider, generateDraft, getDraftAIProviderConfig, type ThreadMessage } from "@amarnai/ai";
import { getDraftLimit, getDraftQuotaResetsAt, getThreadSortLimit } from "@amarnai/shared";
import { config } from "@amarnai/config";
import { createMailProvider } from "@amarnai/mail";
import { isInjectionEnabled, resolveProviderRef } from "../services/provider-thread.js";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const providerThreadParams = z.object({
  workspaceId: z.string().min(1),
  providerThreadId: z.string().min(1),
  // See ProviderRefKind: absent means a conversation id, "message" is the OWA
  // deeplink read view, whose DOM can name no conversation.
  ref: z.enum(["thread", "message"]).default("thread"),
});

const draftParams = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
  draftId: z.string().min(1),
});

const drafts = new Hono();

// ─── POST /workspaces/:workspaceId/email-threads/:threadId/generate-draft ──────
//
// Synchronous: loads thread messages + latest classification (if any), calls the
// LLM, persists a PROPOSED Draft row, and returns the draft inline. Returns 422
// if the thread has no messages, or 503 if no AI provider is configured. An
// unsorted thread is drafted without triage context rather than refused.
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

/**
 * The generation itself, addressed by our internal thread id. Split out from the
 * route so the provider-id route below can reuse it verbatim: quota, the
 * placeholder transaction, metering and superseding must behave identically no
 * matter which id the caller happened to know.
 */
async function generateDraftForThread(
  c: Context,
  workspaceId: string,
  threadId: string,
) {
  {
    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: {
        id: true,
        subject: true,
        providerThreadId: true,
        messages: {
          orderBy: { receivedAt: "asc" },
          select: {
            // providerMessageId is fetched only to match Gmail API responses by ID below.
            // It is split off immediately and never reaches the AI layer.
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

    // Split immediately so the AI layer only ever sees ThreadMessage (no internal IDs).
    // providerMessageIds is a parallel array used solely for Gmail body lookup below.
    const providerMessageIds = thread.messages.map((m) => m.providerMessageId);
    const aiMessages: ThreadMessage[] = thread.messages.map(
      ({ providerMessageId: _, ...m }) => m
    );

    // Optional, deliberately. A classification sharpens the draft (it carries the
    // folder's draftPrompt and the triage context lines) but it is not a
    // precondition: buildDraftPrompt omits the whole "## Triage context" section
    // when these are null, and Draft.classificationId is nullable.
    //
    // Requiring one used to make the reply button dead on any unsorted thread,
    // including threads deferred as QUOTA_BLOCKED, which are never classified
    // until the month rolls over or the plan is upgraded. That coupled the DRAFT
    // meter to the THREAD_SORT meter for no technical reason.
    const classification = await db.emailClassification.findFirst({
      where: { emailThreadId: threadId, workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        requiredAction: true,
        suggestedNextStep: true,
        explanation: true,
        finalNode: { select: { name: true, draftPrompt: true } },
      },
    });

    const gmailConnection = await db.emailConnection.findUnique({
      where: { workspaceId },
      select: { provider: true, emailAddress: true, encryptedRefreshToken: true },
    });

    // force=true bypasses the short-circuit that returns an existing PROPOSED
    // draft. Used by the re-generate action: creates a new draft even when one
    // already exists, and counts against quota like any other generation.
    // Carried in a custom header so it survives the Next.js proxy reliably.
    const force = c.req.header("X-Force-Regenerate") === "1";

    // ── Stale threshold shared by the quick check and the transaction ─────────
    const staleThreshold = new Date(Date.now() - DRAFT_GENERATING_STALE_MS);

    // ── Quick check outside the lock ──────────────────────────────────────────
    // For the common case of re-fetching an already-generated draft, avoid
    // acquiring a row lock altogether. Skipped for PROPOSED when force=true.
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
    if (!force && existingDraft?.status === "PROPOSED") {
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

    // Inbox-keyed draft meter context (reset-immune, pooled by inbox, sized by the
    // top plan among workspaces sharing this inbox). Null for the mock/dev path
    // (no Gmail connection), where the draft quota is not metered. `used` here is
    // ignored — the gate re-reads it transactionally under the workspace lock below.
    const draftQuota = gmailConnection
      ? await resolveInboxQuota(gmailConnection.emailAddress, "DRAFT")
      : null;

    let provider;
    try {
      provider = createAIProvider(getDraftAIProviderConfig());
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
      | { kind: "placeholder"; placeholder: { id: string }; supersededId: string | null }
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
      if (!force && existingUnderLock?.status === "PROPOSED") return { kind: "existing_proposed", draft: existingUnderLock };

      // NOTE: do NOT supersede the existing PROPOSED draft here. Doing so before
      // the quota check would reduce the counted total by 1, letting regeneration
      // bypass the limit (user at 3/3 frees a slot then immediately fills it).
      // The supersede happens after the new draft is committed (see below).

      if (config.billing.enforceDraftQuota && draftQuota) {
        const limit = getDraftLimit(draftQuota.plan);
        // Read the reset-immune, inbox-pooled draft meter. Recorded on the success
        // transition below, so FAILED generations never burn allowance. Concurrent
        // requests are serialized by the Workspace FOR UPDATE lock above; requests
        // from a different workspace sharing the inbox may overshoot slightly
        // (accepted soft cap).
        const meterRow = await tx.inboxUsageMeter.findUnique({
          where: {
            inboxKey_kind_windowStart: {
              inboxKey: draftQuota.inboxKey,
              kind: "DRAFT",
              windowStart: draftQuota.windowStart,
            },
          },
          select: { used: true },
        });
        const used = meterRow?.used ?? 0;

        if (used >= limit) {
          return {
            kind: "quota_exceeded",
            used,
            limit,
            resetsAt: getDraftQuotaResetsAt(new Date()),
          };
        }
      }

      const placeholder = await tx.draft.create({
        data: {
          workspaceId,
          emailThreadId: threadId,
          classificationId: classification?.id ?? null,
          subject: thread.subject ? `Re: ${thread.subject}` : "",
          body: "",
          status: "GENERATING",
        },
        select: { id: true },
      });

      return {
        kind: "placeholder",
        placeholder,
        supersededId: (force && existingUnderLock?.status === "PROPOSED") ? existingUnderLock.id : null,
      };
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

    const { placeholder, supersededId } = txResult;

    // Fetch full body texts from Gmail (one call for all messages in the thread).
    // Falls back to DB bodyText for mock inbox (no Gmail connection) or on error.
    let messagesForDraft: ThreadMessage[] = aiMessages;
    if (gmailConnection?.encryptedRefreshToken) {
      try {
        const client = createMailProvider(gmailConnection);
        const snapshot = await client.getThreadSnapshot(thread.providerThreadId);
        const bodyByMessageId = new Map(
          snapshot.messages.map((m) => [m.providerMessageId, m.bodyExcerpt])
        );
        messagesForDraft = aiMessages.map((m, i) => ({
          ...m,
          bodyText: bodyByMessageId.get(providerMessageIds[i]!) ?? m.bodyText,
        }));
      } catch {
        // Non-fatal: fall back to DB values
      }
    }

    let result;
    try {
      result = await generateDraft(provider, messagesForDraft, {
        requiredAction: classification?.requiredAction ?? null,
        suggestedNextStep: classification?.suggestedNextStep ?? null,
        explanation: classification?.explanation ?? null,
        finalNodeName: classification?.finalNode?.name ?? null,
        senderEmail: gmailConnection?.emailAddress ?? null,
        draftInstructions: classification?.finalNode?.draftPrompt ?? null,
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

    // Record the successful generation against the reset-immune inbox meter. Only
    // committed (non-FAILED) drafts count, so a failed LLM call never burns
    // allowance. Runs regardless of the enforce flag (self-host observability).
    if (draftQuota) {
      await recordMeterUsage({
        inboxKey: draftQuota.inboxKey,
        kind: "DRAFT",
        windowStart: draftQuota.windowStart,
        delta: 1,
      });
    }

    // Supersede the old PROPOSED draft now that the new one is committed.
    // Done after the transaction so the quota SQL never sees the slot freed.
    if (supersededId) {
      void db.draft.updateMany({
        where: { id: supersededId, status: "PROPOSED" },
        data: { status: "FAILED", errorMessage: "Superseded by regeneration" },
      }).catch(() => {});
    }

    console.log(`[drafts] Generated draft ${draft.id} for thread ${threadId}`);
    return c.json({ draft }, 201);
  }
}

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
    return generateDraftForThread(c, parsed.data.workspaceId, parsed.data.threadId);
  }
);

// ─── POST /workspaces/:wid/provider-threads/:providerThreadId/generate-draft ───
//
// Same generation, addressed by the provider's own thread id. Used by the native
// Gmail/Outlook reply button, which knows the mailbox's thread id but not ours.
// Mirrors the provider-id summary route: one round trip from the mail page, and
// the same workspace kill-switch, because the extension is the half we do not
// control. A thread we have not synced is a 404 and the button stays quiet.

drafts.post(
  "/workspaces/:workspaceId/provider-threads/:providerThreadId/generate-draft",
  async (c) => {
    const parsed = providerThreadParams.safeParse({
      workspaceId: c.req.param("workspaceId"),
      providerThreadId: c.req.param("providerThreadId"),
      ref: c.req.query("ref") ?? undefined,
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, providerThreadId, ref } = parsed.data;

    if (!(await isInjectionEnabled(workspaceId, "replyButton"))) {
      return c.json(
        {
          error: "Reply button injection is disabled for this workspace",
          injectionDisabled: true,
        },
        403
      );
    }

    const threadId = await resolveProviderRef(workspaceId, ref, providerThreadId);
    if (!threadId) return c.json({ error: "Thread not found" }, 404);

    return generateDraftForThread(c, workspaceId, threadId);
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

    const connection = await db.emailConnection.findUnique({
      where: { workspaceId },
      select: { emailAddress: true },
    });

    const now = new Date();
    const quota = connection ? await resolveInboxQuota(connection.emailAddress, "DRAFT", now) : null;
    const limit = getDraftLimit(quota?.plan ?? "FREE");

    return c.json({
      used: quota?.used ?? 0,
      limit,
      resetsAt: getDraftQuotaResetsAt(now).toISOString(),
    });
  }
);

// ─── GET /workspaces/:workspaceId/thread-sort-quota ───────────────────────────
//
// Returns the workspace's thread-sort usage for the active calendar-month window:
//   { used, limit, resetsAt, recurring, backfill }
// "used" (== recurring) counts distinct threads sorted by recurring sources this
// month and is what the monthly limit meters. "backfill" reports distinct threads
// sorted by the one-time historical backfill, which is exempt from the limit.

drafts.get(
  "/workspaces/:workspaceId/thread-sort-quota",
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) {
      return c.json({ error: "Invalid params" }, 400);
    }

    const connection = await db.emailConnection.findUnique({
      where: { workspaceId },
      select: { emailAddress: true },
    });

    const now = new Date();
    const quota = connection ? await resolveInboxQuota(connection.emailAddress, "THREAD_SORT", now) : null;
    const limit = getThreadSortLimit(quota?.plan ?? "FREE");

    // "used"/"recurring" come from the reset-immune, inbox-pooled meter (what the
    // limit enforces). "backfill" stays a per-workspace informational count of
    // one-time historical sorts (exempt from the limit).
    const used = quota?.used ?? 0;
    const usage = await getThreadSortUsage(workspaceId, quota?.windowStart ?? meterWindowStart(now));

    return c.json({
      used,
      limit,
      resetsAt: getDraftQuotaResetsAt(now).toISOString(),
      recurring: used,
      backfill: usage.backfill,
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

export { drafts as draftsRoute };
