import { Hono } from "hono";
import { z } from "zod";
import { isInjectionEnabled, resolveProviderRef } from "../services/provider-thread.js";
import { loadThreadDetail } from "../services/thread-detail.js";
import type { AppEnv } from "../env.js";

const providerThreadParams = z.object({
  workspaceId: z.string().min(1),
  providerThreadId: z.string().min(1),
  // Which kind of id the path segment holds. Absent means a conversation id,
  // which is what every layout but OWA's standalone deeplink read view can name;
  // see ProviderRefKind. Enumerated rather than free text so an unknown value is
  // a 400 and never a silent fall back to the wrong lookup.
  ref: z.enum(["thread", "message"]).default("thread"),
});

const providerThreads = new Hono<AppEnv>();

// ─── GET /workspaces/:workspaceId/provider-threads/:providerThreadId ───────────
//
// The panel injected into Gmail/Outlook knows only the mailbox's own thread id,
// and needs the whole thread the moment the user opens it. Resolving and
// fetching in one round trip (rather than resolve → fetch) matters here: the
// panel re-runs this on every conversation change, inside a mail client the
// user is already scrolling through.
//
// The body is byte-for-byte what /email-threads/:threadId returns — same
// serializer — so the panel and the web app can share every component that
// renders a thread.
//
// Gated by the workspace's injected-panel kill switch, like the other
// provider-id routes: the extension is the half we do not control, so an old
// build must stop working the moment the workspace turns the panel off. A
// thread we never synced is a 404, which the panel renders as "not synced yet"
// rather than as an error.

providerThreads.get(
  "/workspaces/:workspaceId/provider-threads/:providerThreadId",
  async (c) => {
    const parsed = providerThreadParams.safeParse({
      workspaceId: c.req.param("workspaceId"),
      providerThreadId: c.req.param("providerThreadId"),
      ref: c.req.query("ref") ?? undefined,
    });
    if (!parsed.success) return c.json({ error: "Invalid params" }, 400);
    const { workspaceId, providerThreadId, ref } = parsed.data;

    if (!(await isInjectionEnabled(workspaceId, "injectedPanel"))) {
      return c.json(
        {
          error: "The in-mail panel is disabled for this workspace",
          injectionDisabled: true,
        },
        403,
      );
    }

    const threadId = await resolveProviderRef(workspaceId, ref, providerThreadId);
    if (!threadId) return c.json({ error: "Thread not found" }, 404);

    const detail = await loadThreadDetail(workspaceId, threadId);
    if (!detail) return c.json({ error: "Thread not found" }, 404);

    return c.json(detail);
  },
);

export { providerThreads as providerThreadsRoute };
