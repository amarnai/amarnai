import { Hono } from "hono";
import { z } from "zod";
import {
  db,
  getInboxBackfillCeiling,
  getMeterUsed,
  getBackfillGraceUsed,
  inboxKeyFor,
  meterWindowStart,
  MeterKind,
} from "@aziru/db";
import { getBackfillCap, isTaxonomyRoutable } from "@aziru/shared";
import { config } from "@aziru/config";
import { isStripeConfigured } from "@aziru/billing";

const workspaceParam = z.object({ workspaceId: z.string().min(1) });

const syncStatus = new Hono();

/**
 * GET /workspaces/:workspaceId/sync-status
 *
 * Returns the current ProviderSyncState for the workspace's connected Gmail
 * inbox, or null if no sync has run yet (no EmailAccount or no
 * ProviderSyncState row exists).
 */
syncStatus.get("/workspaces/:workspaceId/sync-status", async (c) => {
  const parsed = workspaceParam.safeParse({ workspaceId: c.req.param("workspaceId") });
  if (!parsed.success) return c.json({ error: "Invalid workspace ID" }, 400);

  const { workspaceId } = parsed.data;

  // Resolve the GmailConnection → EmailAccount → ProviderSyncState chain.
  const connection = await db.emailConnection.findUnique({
    where: { workspaceId },
    select: {
      subjectId: true,
      emailAddress: true,
      watchExpiresAt: true,
      status: true,
    },
  });

  if (!connection) return c.json(null, 200);

  // A disconnected inbox is no longer importing, and no upgrade can resume it —
  // the token is gone. Suppress every import/backfill/plan-cap signal so the
  // "loading past threads", "finished importing… upgrade to load the rest", and
  // routing banners never show for a dead connection. The separate connection
  // query drives the DisconnectedBanner (reconnect CTA), which is the only
  // relevant message in this state.
  const disconnected = connection.status === "DISCONNECTED";

  const providerAccountId = connection.subjectId ?? connection.emailAddress;

  const account = await db.emailAccount.findUnique({
    where: { workspaceId_providerAccountId: { workspaceId, providerAccountId } },
    select: { id: true },
  });

  if (!account) return c.json(null, 200);

  const [state, syncSettings, workspace] = await Promise.all([
    db.providerSyncState.findUnique({
      where: { emailAccountId: account.id },
      select: {
        status: true,
        lastSyncedAt: true,
        errorMessage: true,
        backfillStatus: true,
        backfillSkipped: true,
        backfillCompletedAt: true,
        backfillCapReached: true,
        backfillBeyondCount: true,
        backfillLimitState: true,
        backfillProcessedCount: true,
        backfillRoutingStartedAt: true,
      },
    }),
    db.gmailSyncSettings.findUnique({
      where: { workspaceId },
      select: { sortingPaused: true },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    }),
  ]);

  if (!state) return c.json(null, 200);

  // `backfillCapReached` is a snapshot persisted by the backfill job at the moment
  // the pooled budget was exhausted. It can drift from reality in BOTH directions, so
  // re-validate it against the live pooled meter (read-only — getMeterUsed/
  // getBackfillGraceUsed do not write):
  //   - Too tight: the monthly window rolled over (pool replenished) or an upgrade
  //     raised the cap. The flag is only recomputed on the next backfill run, which may
  //     never re-trigger, so we'd otherwise show "you hit your limit, upgrade" while the
  //     inbox actually has room. Relax it to NONE.
  //   - Too loose: a row written before the backfillLimitState column existed reads
  //     NONE while the inbox is genuinely at/over its pooled cap (the column defaulted
  //     to NONE and a DONE backfill never re-derives it). The banner would stay hidden.
  //     Engage it, deriving CAPPED vs BLOCKED from whether the grace re-import is spent.
  let backfillCapReached = state.backfillCapReached;
  let backfillBeyondCount = state.backfillBeyondCount;
  let backfillLimitState = state.backfillLimitState;
  if (backfillCapReached) {
    // Match the worker's backfill cap exactly (payment-gated), so the banner's
    // relax/CAPPED/BLOCKED derivation reflects what the backfill job actually enforces.
    const ceiling = await getInboxBackfillCeiling(connection.emailAddress, {
      requirePayment: config.billing.enforceBackfillPaymentGate,
    });
    const cap = getBackfillCap(ceiling.plan, ceiling.billingCycle).maxThreads;
    const inboxKey = inboxKeyFor(connection.emailAddress);
    const windowStart = meterWindowStart();
    const used = await getMeterUsed(inboxKey, MeterKind.BACKFILL, windowStart);
    if (used < cap) {
      backfillCapReached = false;
      backfillBeyondCount = 0;
      backfillLimitState = "NONE";
    } else if (backfillLimitState === "NONE") {
      // Rolling 12-month grace: BLOCKED only if the inbox already spent its grace
      // re-import this year; otherwise a retry is still available (CAPPED).
      const graceUsed = await getBackfillGraceUsed(inboxKey);
      backfillLimitState = graceUsed ? "BLOCKED" : "CAPPED";
    }
  }

  const now = new Date();
  const pushEnabled =
    connection.watchExpiresAt != null && connection.watchExpiresAt > now;

  // Backfill loading progress is only meaningful while a backfill is running.
  // While it is, report how many past threads the backfill has processed so far
  // (backfillLoadedThreads) — used for telemetry/debugging; the card itself shows a
  // count-less "loading" indicator since Gmail exposes no reliable total. Also
  // report whether the taxonomy is too small to route any threads yet, which adapts
  // the card wording.
  let backfillAwaitingTaxonomy = false;
  let backfillLoadedThreads = 0;
  const backfillTotalThreads = 0;

  if (state.backfillStatus === "RUNNING") {
    backfillLoadedThreads = state.backfillProcessedCount;

    const [taxonomyNodes, taxonomyEdges] = await Promise.all([
      db.taxonomyNode.findMany({
        where: { workspaceId },
        select: { id: true, isRoot: true, isCatchAll: true },
      }),
      db.taxonomyEdge.findMany({
        where: { workspaceId },
        select: { sourceNodeId: true, targetNodeId: true },
      }),
    ]);

    backfillAwaitingTaxonomy = !isTaxonomyRoutable(taxonomyNodes, taxonomyEdges);
  }

  return c.json({
    status: state.status,
    lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
    errorMessage: state.errorMessage,
    backfillStatus: disconnected ? "DONE" : state.backfillStatus,
    backfillSkipped: state.backfillSkipped,
    backfillCompletedAt: state.backfillCompletedAt?.toISOString() ?? null,
    backfillCapReached: disconnected ? false : backfillCapReached,
    backfillBeyondCount: disconnected ? 0 : backfillBeyondCount,
    backfillLimitState: disconnected ? "NONE" : backfillLimitState,
    backfillLoadedThreads,
    backfillTotalThreads,
    backfillAwaitingTaxonomy,
    // Whether the user has started backfill routing. Until then the import runs
    // but nothing is classified; clients surface the "Start sorting" action.
    backfillRoutingStarted: disconnected ? false : state.backfillRoutingStartedAt != null,
    sortingPaused: syncSettings?.sortingPaused ?? false,
    workspacePlan: workspace?.plan ?? "FREE",
    // Whether plans can be bought in this deployment at all. Self-hosted
    // installs run without Stripe, and a client cannot tell that apart from
    // "you are on the free plan" — without this it would offer an upgrade that
    // can only fail. Travels with workspacePlan because the two are always read
    // together: what you are on, and whether anything else is purchasable.
    //
    // Read from THIS process even though checkout runs in the web app. That is
    // not a mismatch: account deletion here cancels subscriptions through Stripe
    // (see cancelSubscriptionsForAccountDeletion), so any deployment selling
    // plans must configure the key on both sides. An API without it is already
    // unable to stop billing a deleted account, and should not be advertising
    // upgrades either.
    billingEnabled: isStripeConfigured(),
    pushEnabled,
  });
});

export { syncStatus as syncStatusRoute };
