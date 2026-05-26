import { Hono } from "hono";
import { z } from "zod";
import { db } from "@amarnai/db";

const params = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().min(1),
});

const approveBody = z.object({ action: z.literal("approve") });
const moveBody = z.object({ action: z.literal("move"), nodeId: z.string().min(1) });
const bodySchema = z.union([approveBody, moveBody]);

const triage = new Hono();

// ─── PATCH /workspaces/:workspaceId/email-threads/:threadId/triage ────────────
//
// Two actions:
//  • approve — mark thread SORTED without changing destination
//  • move    — create a manual classification to a chosen node, mark SORTED

triage.patch(
  "/workspaces/:workspaceId/email-threads/:threadId/triage",
  async (c) => {
    const parsed = params.safeParse({
      workspaceId: c.req.param("workspaceId"),
      threadId: c.req.param("threadId"),
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid params" }, 400);
    }
    const { workspaceId, threadId } = parsed.data;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: "Invalid action. Expected 'approve' or 'move' with nodeId." }, 400);
    }

    const thread = await db.emailThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true, triageStatus: true },
    });
    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const action = parsedBody.data;

    if (action.action === "approve") {
      // ── Approve: accept the current AI destination, mark SORTED ──────────────
      await db.emailThread.update({
        where: { id: threadId },
        data: { triageStatus: "SORTED" },
      });

      return c.json({ ok: true, triageStatus: "SORTED" });
    }

    // ── Move: create a manual classification to the chosen node ──────────────
    const { nodeId } = action;

    const node = await db.taxonomyNode.findFirst({
      where: { id: nodeId, workspaceId },
      select: { id: true, name: true },
    });
    if (!node) {
      return c.json({ error: "Taxonomy node not found" }, 404);
    }

    await db.$transaction(async (tx) => {
      await tx.emailClassification.create({
        data: {
          workspaceId,
          emailThreadId: threadId,
          finalNodeId: nodeId,
          confidence: 1.0,
          explanation: `Manually moved to "${node.name}" by user.`,
          needsHumanReview: false,
          modelProvider: "user",
          modelName: "manual",
        },
      });

      await tx.emailThread.update({
        where: { id: threadId },
        data: { triageStatus: "SORTED" },
      });
    });

    return c.json({ ok: true, triageStatus: "SORTED", movedToNodeId: nodeId });
  }
);

export { triage as triageRoute };
