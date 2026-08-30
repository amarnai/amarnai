import { Hono } from "hono";
import { db } from "@aziru/db";
import type { AppEnv } from "../env.js";

const mailAccounts = new Hono<AppEnv>();

// ─── GET /me/mail-accounts ─────────────────────────────────────────────────────
//
// Every surface injected into a mail client starts from the same question: the
// page knows which mailbox is open, but every Amarnai call is keyed by
// workspace. Answering it used to mean one /workspaces call plus one
// /gmail-connection call per workspace — O(workspaces) round trips on the
// critical path of opening a thread, on a connection the extension pays for in
// user-visible latency. This collapses it to one.
//
// User-scoped, so it sits outside the /workspaces/:workspaceId/* membership
// guard; tenancy is enforced here by starting from the caller's memberships.
// Returns only workspaces that actually have a mailbox connected — a workspace
// with no connection can never match an open mail page.

mailAccounts.get("/me/mail-accounts", async (c) => {
  const userId: string = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const connections = await db.emailConnection.findMany({
    where: { workspace: { members: { some: { userId } } } },
    select: {
      workspaceId: true,
      provider: true,
      emailAddress: true,
      status: true,
      workspace: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return c.json({
    accounts: connections.map((row) => ({
      // Lowercased here so every caller compares against the same normalization
      // rather than each remembering to fold case itself.
      email: row.emailAddress.toLowerCase(),
      workspaceId: row.workspaceId,
      workspaceName: row.workspace.name,
      provider: row.provider,
      status: row.status,
    })),
  });
});

export { mailAccounts as mailAccountsRoute };
