import { Worker, UnrecoverableError } from "bullmq";
import {
  db,
  getInboxPlanCeiling,
  inboxKeyFor,
  meterWindowStart,
  getMeterUsed,
  recordMeterUsage,
  markGmailConnectionAuthFailed,
  maybeCreateQuotaBlockedNotifications,
} from "@amarnai/db";
import { config } from "@amarnai/config";
import { getThreadSortLimit, MAX_REFERENCES_PER_NODE } from "@amarnai/shared";
import {
  createAIProvider,
  createEmbeddingProvider,
  sortThreadByEmbedding,
  buildRoutingTelemetry,
  CENTERED_ROUTING_CONFIG,
  analyzeThreadTriage,
  classifyTriageByEmbedding,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  snapshotToThreadMessages,
  EmbeddingModelNotFoundError,
  LLMAuthenticationError,
  LLMRequestError,
} from "@amarnai/ai";
import type { EmbeddableNode, TriageMetadata, EmbeddingTriageResult, LlmCallMemoizer } from "@amarnai/ai";
import { createMailProvider, MailAuthError } from "@amarnai/mail";
import {
  QUEUE_CLASSIFY_THREAD,
  type ClassifyThreadJobData,
  pushNotificationQueue,
} from "../queues.js";
import { redisConnection } from "../redis.js";
import {
  buildDedupKey,
  buildEmbeddingCacheKey,
  memoizeAcrossRetries,
  parseVector,
  THREAD_EMBEDDING_TTL_SECONDS,
} from "../ai-dedup.js";
import { getRoutingAIProviderConfig, getEmbeddingProviderConfig } from "@amarnai/ai";
import { isTaxonomyRoutable } from "@amarnai/shared";
import { notifyThreadNeedsAttention } from "../notifications/notify-threads.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Write all 7 triage metadata fields onto an existing classification record. */
async function persistTriageMetadata(
  classificationId: string,
  triage: TriageMetadata
): Promise<void> {
  await db.emailClassification.update({
    where: { id: classificationId },
    data: {
      priority: triage.priority,
      urgency: triage.urgency,
      riskLevel: triage.riskLevel,
      requiredAction: triage.requiredAction,
      sensitivity: triage.sensitivity,
      dueAt: triage.dueAt !== null ? new Date(triage.dueAt) : null,
      suggestedNextStep: triage.suggestedNextStep,
    },
  });
}

/** Write the three embedding-computed triage fields onto an existing classification record. */
async function persistEmbeddingTriage(
  classificationId: string,
  triage: EmbeddingTriageResult
): Promise<void> {
  await db.emailClassification.update({
    where: { id: classificationId },
    data: {
      sensitivity: triage.sensitivity,
      requiredAction: triage.requiredAction,
      suggestedNextStep: triage.suggestedNextStep,
    },
  });
}

/**
 * Best-effort clear of classifyingAt. Used in finally and the failed handler
 * — failures here must never mask an original error.
 */
async function clearClassifyingAt(emailThreadId: string): Promise<void> {
  await db.emailThread
    .update({
      where: { id: emailThreadId },
      data: { classifyingAt: null },
    })
    .catch(() => {});
}

/**
 * Stamp failure markers when a classify job fails permanently. classifyFailedAt
 * makes the thread eligible for the recoverFailedThreads sweep (distinguishing
 * it from the never-attempted bulk backlog); classifyAttempts bounds retries so
 * a persistently failing thread is not re-enqueued forever. Best-effort: a
 * failure to record must not crash the failed handler.
 */
async function markClassifyFailed(emailThreadId: string): Promise<void> {
  await db.emailThread
    .update({
      where: { id: emailThreadId },
      data: { classifyingAt: null, classifyFailedAt: new Date(), classifyAttempts: { increment: 1 } },
    })
    .catch(() => {});
}

// ── Worker ─────────────────────────────────────────────────────────────────────

export function createClassifyThreadWorker(): Worker {
  const worker = new Worker<ClassifyThreadJobData>(
    QUEUE_CLASSIFY_THREAD,
    async (job) => {
      const { workspaceId, emailThreadId, triageOnly = false, source = "LIVE" } = job.data;

      console.log(
        `[classify-thread] Job ${job.id} received — thread ${emailThreadId} (workspace ${workspaceId})${triageOnly ? " [triage-only]" : ""}`,
      );

      // ── 1. Load thread + Gmail connection ──────────────────────────────────
      //
      // GmailConnection.encryptedRefreshToken is the authoritative token source —
      // always kept fresh by the OAuth callback. EmailAccount.refreshTokenEncrypted
      // is only written on first create (update: {}) and can become stale after a
      // token rotation or key change, so we do not use it here.

      const [thread, connection, syncSettings] = await Promise.all([
        db.emailThread.findFirst({
          where: { id: emailThreadId, workspaceId },
          select: { providerThreadId: true, isAutomated: true },
        }),
        db.emailConnection.findUnique({
          where: { workspaceId },
          select: { provider: true, encryptedRefreshToken: true, status: true, emailAddress: true },
        }),
        db.gmailSyncSettings.findUnique({
          where: { workspaceId },
          select: { routeBulkToOther: true },
        }),
      ]);

      if (!thread) throw new Error(`EmailThread not found: ${emailThreadId}`);
      if (!connection || connection.status !== "ACTIVE") {
        console.log(
          `[classify-thread] Workspace ${workspaceId} has no active Gmail connection — skipping thread ${emailThreadId}`
        );
        return;
      }

      // Automated/bulk mail (notifications, newsletters, service updates) is
      // auto-filed to the catch-all folder without an LLM call when the setting
      // is on (default true). This both exempts the thread from the monthly LLM
      // quota and suppresses LLM escalation during the embedding sort below.
      const routeBulkAutomated = thread.isAutomated && (syncSettings?.routeBulkToOther ?? true);

      try {
        // ── 1a. Manual-move pin ──────────────────────────────────────────────
        //
        // A thread whose latest classification is a manual MOVE stays where the
        // user put it: automatic re-sorts (LIVE on a new message, BACKFILL,
        // REROUTE sweeps) are skipped so the human decision is never silently
        // superseded. An explicit user-triggered sort (source MANUAL) bypasses
        // the pin — it IS the unpin action — and triage-only jobs pass through
        // because they refresh metadata without touching routing. Runs before
        // the quota gate so a pinned skip is never metered; the finally block
        // clears any enqueue-time classifyingAt.
        if (!triageOnly && source !== "MANUAL") {
          const latestClassification = await db.emailClassification.findFirst({
            where: { emailThreadId, workspaceId },
            orderBy: { createdAt: "desc" },
            select: { source: true },
          });
          if (latestClassification?.source === "MOVE") {
            console.log(
              `[classify-thread] Thread ${emailThreadId} is pinned by a manual move — skipping ${source} re-sort`,
            );
            return;
          }
        }

        // ── 1b. Monthly thread-sort quota (recurring sorts only) ────────────
        //
        // Runs before stamping classifyingAt so a deferred thread is not briefly
        // shown as "classifying". BACKFILL is exempt — it is a separate one-time
        // historical allowance. When the workspace is at or over its plan's
        // monthly limit, defer this thread as QUOTA_BLOCKED instead of sorting it:
        // the thread is not lost (it is re-enqueued on month rollover or plan
        // upgrade) and not churned (QUOTA_BLOCKED is excluded from stuck-recovery
        // and resume). The count excludes the current thread so re-sorting a
        // thread already counted this month is never blocked. Concurrent workers
        // can overshoot the limit slightly (check-then-act race); accepted as a
        // soft cap. The finally block clears the enqueue-time classifyingAt.
        // A billable, metered sort: a real embedding/LLM classification that the
        // monthly quota counts. BACKFILL is exempt (one-time allowance) and
        // automated/bulk mail is filed without an LLM call, so neither counts.
        const meteredSort = !triageOnly && source !== "BACKFILL" && !routeBulkAutomated;
        const inboxKey = inboxKeyFor(connection.emailAddress);
        const meterWindow = meterWindowStart();

        // The quota counts DISTINCT threads. A re-sort of a thread already counted
        // this window is free — never blocked, never re-counted — so we check first
        // and skip both the gate and the record below for it.
        let alreadyCountedThisWindow = false;
        if (meteredSort) {
          alreadyCountedThisWindow =
            (await db.emailClassification.count({
              where: {
                emailThreadId,
                source: { notIn: ["BACKFILL", "MOVE", "MIGRATION"] },
                createdAt: { gte: meterWindow },
              },
            })) > 0;

          // Gate against the reset-immune, inbox-pooled meter (sized by the top plan
          // among workspaces sharing this inbox). Over the limit → defer as
          // QUOTA_BLOCKED (re-enqueued on month rollover or plan upgrade; excluded
          // from stuck-recovery and resume). Concurrent workers may overshoot
          // slightly (check-then-act); accepted as a soft cap.
          if (config.billing.enforceThreadSortQuota && !alreadyCountedThisWindow) {
            const { plan } = await getInboxPlanCeiling(connection.emailAddress);
            const limit = getThreadSortLimit(plan);
            const used = await getMeterUsed(inboxKey, "THREAD_SORT", meterWindow);
            if (used >= limit) {
              console.log(
                `[classify-thread] Inbox ${inboxKey} at thread-sort quota (${used}/${limit}) — deferring thread ${emailThreadId} as QUOTA_BLOCKED`,
              );
              await db.emailThread.update({
                where: { id: emailThreadId },
                data: { triageStatus: "QUOTA_BLOCKED" },
              });
              // Notify members that sorting is paused — deduped to once per meter
              // window, so a burst of blocked threads produces a single nudge.
              // Fire-and-forget: must never fail or retry the classify job.
              void maybeCreateQuotaBlockedNotifications({ workspaceId, windowStart: meterWindow }).catch(
                (notifyErr) =>
                  console.error(
                    `[classify-thread] quota_blocked notify failed for workspace ${workspaceId}:`,
                    notifyErr instanceof Error ? notifyErr.message : notifyErr,
                  ),
              );
              return;
            }
          }
        }

        // ── 1c. Mark thread as actively classifying ─────────────────────────
        //
        // Inside the try so the finally block is guaranteed to clear it.
        // If the worker crashes without running finally, the API treats
        // classifyingAt older than 15 minutes as stale (isClassifying=false)
        // but still uses it for isQueued=true until the failed handler clears
        // it after all retries are exhausted.

        await db.emailThread.update({
          where: { id: emailThreadId },
          data: { classifyingAt: new Date() },
        });

        // ── 2. Re-fetch thread from Gmail ───────────────────────────────────

        const client = createMailProvider(connection);

        let snapshot: Awaited<ReturnType<typeof client.getThreadSnapshot>>;
        try {
          snapshot = await client.getThreadSnapshot(thread.providerThreadId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Thread deleted from the provider after we enqueued the job — nothing to do.
          if (msg.includes("not found")) return;
          throw err;
        }

        if (snapshot.messages.length === 0) return;

        const messages = snapshotToThreadMessages(snapshot);

        await job.updateProgress(20);

        const aiProvider = createAIProvider(getRoutingAIProviderConfig());

        if (triageOnly) {
          // ── Triage-only path ──────────────────────────────────────────────
          //
          // Skip routing entirely. Re-run the triage metadata analysis and update
          // the most recent existing classification record. triageStatus is left
          // unchanged — the user is satisfied with the routing result.

          const existingClassification = await db.emailClassification.findFirst({
            where: { emailThreadId, workspaceId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });

          if (!existingClassification) {
            throw new Error(
              `No existing classification for thread ${emailThreadId} — sort first before re-analyzing`
            );
          }

          await job.updateProgress(40);

          const triage = await analyzeThreadTriage(aiProvider, messages);

          if (triage === null) {
            // Unlike the full classification path where routing already
            // succeeded and triage is supplementary, triage-only has no
            // fallback — the entire purpose of the job was to get metadata.
            // Throw so BullMQ retries and the classifying indicator stays
            // active rather than silently disappearing with no result.
            throw new Error(
              `Triage analysis returned null for thread ${emailThreadId} — LLM failed or returned invalid output`
            );
          }

          await persistTriageMetadata(existingClassification.id, triage);
          console.log(
            `[classify-thread] Triage-only metadata saved for thread ${emailThreadId}: priority=${triage.priority}, urgency=${triage.urgency}`
          );

          await job.updateProgress(95);
        } else {
          // ── Full classification path ──────────────────────────────────────

          // ── 3. Load taxonomy ──────────────────────────────────────────────

          const [rawNodes, rawEdges, rawReferences] = await Promise.all([
            db.taxonomyNode.findMany({
              where: { workspaceId },
              select: {
                id: true,
                name: true,
                description: true,
                instructions: true,
                examples: true,
                isRoot: true,
                isCatchAll: true,
                embeddingVector: true,
                embeddingModel: true,
                embeddingTextHash: true,
              },
            }),
            db.taxonomyEdge.findMany({
              where: { workspaceId },
              select: { id: true, sourceNodeId: true, targetNodeId: true },
            }),
            // Reference threads (manual moves) reinforce their folders in the
            // sorter. Pending rows (empty vector, capture job not done yet) are
            // excluded here; model-mismatched rows and the thread's own row are
            // filtered below once the embedding provider is known.
            db.taxonomyNodeReference.findMany({
              where: { workspaceId, NOT: { embeddingVector: { isEmpty: true } } },
              orderBy: { updatedAt: "desc" },
              select: {
                nodeId: true,
                emailThreadId: true,
                embeddingVector: true,
                embeddingModel: true,
              },
            }),
          ]);

          const rootNode = rawNodes.find((n) => n.isRoot);
          if (!isTaxonomyRoutable(rawNodes, rawEdges)) {
            // Taxonomy is not routable — leave the thread PENDING as bulk backlog
            // (returns without throwing, so no classifyFailedAt is set and it is
            // not auto-recovered). It waits for the user's "Route now" once a
            // valid taxonomy exists. classifyingAt is cleared by the finally block.
            console.log(
              `[classify-thread] Taxonomy not routable for workspace ${workspaceId} — leaving thread ${emailThreadId} as PENDING`
            );
            return;
          }

          const nodes: EmbeddableNode[] = rawNodes.map((n) => ({
            ...n,
            examples: n.examples as string[],
            embeddingVector:
              n.embeddingVector.length > 0 ? n.embeddingVector : null,
          }));

          await job.updateProgress(35);

          // ── 4. Embed the thread ───────────────────────────────────────────
          //
          // Compute the thread vector once and share it with both routing and
          // triage so they can run in parallel (Step 5).

          const embeddingProvider = createEmbeddingProvider(
            getEmbeddingProviderConfig(),
          );

          // nodeId → reference vectors for the sorter. Drops rows embedded under
          // a different model (stale after a model change — they age out or
          // refresh on the next move, mirroring the node embedding cache) and
          // the thread's OWN reference row: its self-similarity ≈ 1 would act as
          // a hidden re-sort pin, and pinning is the explicit guard at step 1a.
          // Rows arrive recency-ordered, so slice keeps the newest per node.
          const referenceVectors = new Map<string, number[][]>();
          for (const ref of rawReferences) {
            if (ref.embeddingModel !== embeddingProvider.modelName) continue;
            if (ref.emailThreadId === emailThreadId) continue;
            const vectors = referenceVectors.get(ref.nodeId) ?? [];
            if (vectors.length >= MAX_REFERENCES_PER_NODE) continue;
            vectors.push(ref.embeddingVector);
            referenceVectors.set(ref.nodeId, vectors);
          }

          const threadText = buildThreadEmbeddingText(
            messages.map((m) => ({
              subject: m.subject,
              bodyText: m.bodyText,
              ...(m.attachmentNames?.length ? { attachmentNames: m.attachmentNames } : {}),
            }))
          );

          // Guard: a thread with no textual signal (empty subject, no body, no
          // attachment names) cannot be embedded. Route directly to NEEDS_REVIEW
          // so the user can triage it manually instead of crash-looping on embed("").
          if (threadText.trim() === "") {
            await db.emailClassification.create({
              data: {
                workspaceId,
                emailThreadId,
                finalNodeId: rootNode?.id ?? null,
                confidence: 0,
                explanation: "Thread has no textual content to classify.",
                needsHumanReview: true,
                source,
                decisionSource: "no_text_content",
                modelProvider: aiProvider.providerName,
                modelName: aiProvider.modelName,
              },
            });
            await db.emailThread.update({
              where: { id: emailThreadId },
              data: { triageStatus: "NEEDS_REVIEW", classifyFailedAt: null, classifyAttempts: 0 },
            });
            console.log(
              `[classify-thread] Thread ${emailThreadId} has no text content — routed to NEEDS_REVIEW`
            );
            void notifyThreadNeedsAttention({
              workspaceId,
              emailThreadId,
              subject: snapshot.subject,
            }).catch((err) => {
              console.error(
                `[classify-thread] Push notify failed for thread ${emailThreadId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
            return;
          }

          // Cache the thread embedding content-addressed by text hash + model,
          // not by jobId. Any later re-sort of unchanged content — a re-route
          // after a taxonomy edit, a resume, or a retry of this job — reads the
          // vector back instead of re-paying the embedding cost. The TTL bounds
          // Redis memory (see THREAD_EMBEDDING_TTL_SECONDS). Fails open: Redis
          // trouble just recomputes (see ai-dedup.ts).
          const embeddingCacheKey = buildEmbeddingCacheKey(
            workspaceId,
            hashEmbeddingInput(threadText, embeddingProvider.modelName),
            embeddingProvider.modelName,
          );
          const threadVector = await memoizeAcrossRetries<number[]>(
            embeddingCacheKey,
            {
              compute: async () => {
                const [v] = await embeddingProvider.embed([threadText]);
                return v ?? [];
              },
              serialize: (v) => JSON.stringify(v),
              deserialize: parseVector,
              // Never cache an empty vector: it's a failed embed, and caching it
              // would skip the outer embed on the next attempt while the sorter
              // re-embeds anyway. Leaving it uncached lets a retry re-embed cleanly.
              shouldCache: (v) => v.length > 0,
            },
            THREAD_EMBEDDING_TTL_SECONDS,
          );

          await job.updateProgress(45);

          // ── 5. Route + triage in parallel ─────────────────────────────────
          //
          // Both operations share the pre-computed thread vector. Routing may
          // trigger an LLM call for cross-branch ambiguity; triage runs
          // concurrently using only embeddings.
          //
          // Memoize that cross-branch LLM call across this job's retries the
          // same way the thread embedding is memoized above: a failure after
          // the call (e.g. a DB write below) re-runs sortThreadByEmbedding on
          // the next attempt, and this replays the cached raw response instead
          // of re-paying for it. The sorter supplies a per-call-site `step`;
          // buildDedupKey scopes the key by workspace, jobId, and model. The
          // sorter still re-validates the cached raw string (Zod + policy) on
          // every read, so a hit is never trusted blindly. Fails open.
          const llmMemoizer: LlmCallMemoizer = (step, compute) =>
            memoizeAcrossRetries<string>(
              buildDedupKey(workspaceId, job.id, step, aiProvider.modelName),
              {
                compute,
                serialize: (s) => JSON.stringify(s),
                deserialize: (raw) => {
                  try {
                    const v: unknown = JSON.parse(raw);
                    return typeof v === "string" && v.length > 0 ? v : null;
                  } catch {
                    return null;
                  }
                },
                // Never cache an empty response: it carries no decision and
                // would suppress a clean recompute on the next attempt.
                shouldCache: (s) => s.length > 0,
              },
            );

          const [result, embeddingTriage] = await Promise.all([
            sortThreadByEmbedding(
              embeddingProvider,
              aiProvider,
              nodes,
              rawEdges,
              messages,
              {
                ...(threadVector ? { precomputedThreadVector: threadVector } : {}),
                llmMemoizer,
                // Human-moved exemplars lift their folders' similarity scores
                // (max-blend; empty map is a no-op). See REFERENCE_SIM_WEIGHT.
                referenceVectors,
                // Production routing config: scale-invariant + mean-centering with
                // constants tuned for Gemini. Centering corrects the embedding
                // anisotropy (similarities bunch into a narrow high band) that
                // otherwise collapses the routing margin. See sortThreadByEmbedding.
                ...CENTERED_ROUTING_CONFIG,
                // On the final retry, a thrown LLM error becomes an inbox
                // fallback (→ NEEDS_REVIEW) instead of failing the job and
                // stranding the thread as PENDING. Earlier attempts rethrow so
                // BullMQ can retry a transient blip.
                failOpenOnLlmError: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
                // Bulk/automated threads never call the LLM; an unconfident
                // embedding result is mapped to the catch-all folder below.
                suppressLlmEscalation: routeBulkAutomated,
              },
            ),
            threadVector && threadVector.length > 0
              ? classifyTriageByEmbedding(threadVector, embeddingProvider).catch((e) => {
                  console.error(
                    `[classify-thread] Embedding triage failed for thread ${emailThreadId}: ${String(e)}`
                  );
                  return null;
                })
              : Promise.resolve(null),
          ]);

          await job.updateProgress(70);

          // ── 6. Persist updated node embedding cache ───────────────────────

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
                }),
              ),
            );
          }

          // ── 6b. Automated-mail policy (P2: embedding safety net) ──────────
          //
          // The LLM was suppressed for bulk/automated threads. If embeddings did
          // NOT confidently place the thread in a real folder (anything other
          // than embedding_auto), file it in the catch-all folder instead of
          // leaving it for human review — at zero LLM cost. A confident
          // embedding match to a real folder is kept (the safety net against a
          // false-positive automation flag). If no catch-all node exists, the
          // embedding result stands unchanged.
          const catchAllNode = nodes.find((n) => n.isCatchAll);
          const filedToCatchAll =
            routeBulkAutomated && catchAllNode != null && result.decisionSource !== "embedding_auto";

          const finalNodeId = filedToCatchAll ? catchAllNode!.id : result.finalNodeId;
          const confidence = filedToCatchAll ? 1.0 : result.confidence;
          const explanation = filedToCatchAll
            ? `Auto-filed to "${catchAllNode!.name}" (automated/bulk mail).`
            : result.explanation;
          const needsHumanReview = filedToCatchAll ? false : result.needsHumanReview;
          const decisionSource: string = filedToCatchAll ? "automated_bulk" : result.decisionSource;
          // Mark rows produced by a transient infrastructure failure (LLM
          // fail-open on the final retry, or thread-embedding failure) so a later
          // bulk re-sort can pick them up even when the taxonomy has not changed.
          // Never set for a bulk auto-file (it did not fail).
          const transientFailure =
            !filedToCatchAll &&
            (result.fallbackCause === "llm_error" || result.fallbackCause === "embedding_failed");

          // ── 7. Persist routing result + triage ────────────────────────────

          const { id: classificationId } = await db.emailClassification.create({
            data: {
              workspaceId,
              emailThreadId,
              finalNodeId,
              confidence,
              explanation,
              needsHumanReview,
              transientFailure,
              source,
              decisionSource,
              modelProvider: aiProvider.providerName,
              modelName: aiProvider.modelName,
              // Compact routing telemetry (maxima + top-K node sims). The scores
              // are already computed during sorting; persisting the trimmed
              // summary adds no compute and keeps the row small while enabling
              // post-hoc diagnosis and data-driven threshold tuning.
              // Telemetry threshold matches the routing config in use (centered
              // similarities sit on a lower absolute scale than raw cosine).
              rawOutput: buildRoutingTelemetry(result, CENTERED_ROUTING_CONFIG.thetaMin),
            },
            select: { id: true },
          });

          // Record one distinct-thread sort against the reset-immune inbox meter,
          // the first time this thread is metered this window. Runs unconditionally
          // (independent of the enforce flag) so self-host gets usage observability.
          if (meteredSort && !alreadyCountedThisWindow) {
            await recordMeterUsage({
              inboxKey,
              kind: "THREAD_SORT",
              windowStart: meterWindow,
              delta: 1,
            });
            // Only count once per thread per window even if it re-sorts later in
            // this same job lifetime.
            alreadyCountedThisWindow = true;
          }

          const isUnclassified = rootNode != null && finalNodeId === rootNode.id;
          const triageStatus = isUnclassified
            ? "UNCLASSIFIED"
            : needsHumanReview
              ? "NEEDS_REVIEW"
              : "SORTED";
          await db.emailThread.update({
            where: { id: emailThreadId },
            // Clear any prior failure markers — this thread classified
            // successfully, so it is no longer eligible for failure recovery.
            data: { triageStatus, classifyFailedAt: null, classifyAttempts: 0 },
          });

          // ── 7b. Push notification — thread needs attention ────────────────
          //
          // Fire-and-forget on the existing sort-completion path: when a sort
          // lands on NEEDS_REVIEW the user has to make a call, so we nudge their
          // registered devices. Tenant-scoped + rate-limited inside the notifier.
          // Never awaited into the job result — a push failure must not fail or
          // retry classification (which is the source of truth).
          //
          // Suppress the push when NEEDS_REVIEW came from an LLM-error fail-open
          // (result.failedOpenOnError): an outage flips many threads to review at
          // once, and pushing each would storm every user's devices for what is a
          // transient infrastructure problem, not a real triage signal. The thread
          // is still visible in-app and re-sorts cleanly once the provider recovers.
          if (result.failedOpenOnError) {
            console.warn(
              `[classify-thread] workspace=${workspaceId} thread=${emailThreadId} fail-open to review on LLM error — suppressing needs-attention push`,
            );
          }
          if (triageStatus === "NEEDS_REVIEW" && !result.failedOpenOnError) {
            void notifyThreadNeedsAttention({
              workspaceId,
              emailThreadId,
              subject: snapshot.subject,
            }).catch((err) => {
              console.error(
                `[classify-thread] Push notify failed for thread ${emailThreadId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
          }

          if (embeddingTriage !== null) {
            await persistEmbeddingTriage(classificationId, embeddingTriage);
            console.log(
              `[classify-thread] Triage saved for thread ${emailThreadId}: sensitivity=${embeddingTriage.sensitivity}, requiredAction=${embeddingTriage.requiredAction}`
            );
          }

          await job.updateProgress(95);
        }

        await job.updateProgress(100);
      } catch (err) {
        if (err instanceof MailAuthError) {
          // Token is permanently invalid — mark the connection as disconnected
          // so all remaining queued jobs for this workspace skip immediately.
          // The helper flips the row atomically and notifies members only on the
          // winning flip; enqueue the matching push exactly once, on that flip.
          console.error(
            `[classify-thread] Gmail auth failed for workspace ${workspaceId} — marking connection DISCONNECTED: ${err.message}`,
          );
          const flipped = await markGmailConnectionAuthFailed(workspaceId).catch(() => false);
          if (flipped) {
            await pushNotificationQueue
              .add("push-notification", { kind: "gmail_disconnected", workspaceId })
              .catch(() => {});
          }
          return;
        }
        if (err instanceof EmbeddingModelNotFoundError) {
          // The configured embedding model does not exist — a deployment
          // misconfiguration that affects every thread. Retrying wastes
          // attempts and floods logs, so fail permanently after one attempt.
          console.error(
            `[classify-thread] Embedding model misconfigured — failing thread ${emailThreadId} (workspace ${workspaceId}) without retry: ${err.message}`,
          );
          throw new UnrecoverableError(err.message);
        }
        if (err instanceof LLMAuthenticationError) {
          // The LLM API key is invalid — a deployment misconfiguration that
          // affects every thread. Retrying wastes attempts and floods logs, so
          // fail permanently after one attempt.
          console.error(
            `[classify-thread] LLM auth failed — failing thread ${emailThreadId} (workspace ${workspaceId}) without retry: ${err.message}`,
          );
          throw new UnrecoverableError(err.message);
        }
        if (err instanceof LLMRequestError) {
          // The LLM API rejected the request itself (400/403/404/422) — a
          // deterministic fault (bad model, malformed body) that recurs on an
          // identical retry. Fail permanently rather than burn attempts/cost.
          // (408/429 are NOT mapped to this error, so they still retry.)
          console.error(
            `[classify-thread] LLM request rejected (${err.status}) — failing thread ${emailThreadId} (workspace ${workspaceId}) without retry: ${err.message}`,
          );
          throw new UnrecoverableError(err.message);
        }
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const remaining = maxAttempts - attempt;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[classify-thread] Failed attempt ${attempt}/${maxAttempts} for thread ${emailThreadId} (workspace ${workspaceId}): ${msg}`,
          remaining > 0
            ? `— ${remaining} retry attempt(s) left`
            : "— no retries left",
        );
        throw err;
      } finally {
        await clearClassifyingAt(emailThreadId);
      }
    },
    {
      connection: redisConnection,
      // Ollama processes requests serially — a single slow model inference
      // (30-120 s) blocks every concurrent HTTP request queued behind it.
      // With concurrency > 1, the last job in line easily exceeds the
      // 5-minute headers timeout before Ollama even starts responding.
      // For frontier LLM APIs (OpenAI, Anthropic) that handle parallel
      // requests natively, higher concurrency is fine.
      concurrency: (process.env["AI_PROVIDER"] ?? "mock") === "ollama" ? 1 : 5,
      // LLM + embedding calls can take several minutes with local Ollama.
      // The lock auto-renews every lockDuration/2 ms while the job is running,
      // so 5 minutes covers even the slowest models without false stalls.
      lockDuration: 300_000,
      // Tolerate up to 3 stalls (e.g. dev-server hot-reloads) before
      // permanently failing a job.  Classification is idempotent so retrying
      // a stalled job is always safe.
      maxStalledCount: 3,
    },
  );

  // When a job is permanently failed (all retries exhausted), the finally
  // block in the processor may not have run (e.g. the job stalled because the
  // worker process was killed). Stamp failure markers here: clears classifyingAt
  // so the thread is not stuck showing "Queued", and records classifyFailedAt /
  // classifyAttempts so recoverFailedThreads can auto-reclassify it later.
  worker.on("failed", (job, err) => {
    if (!job) return;
    const { workspaceId, emailThreadId } = job.data;
    console.error(
      `[classify-thread] Permanently failed for thread ${emailThreadId} (workspace ${workspaceId}) after ${job.attemptsMade} attempt(s):`,
      err,
    );
    void markClassifyFailed(emailThreadId);
  });

  return worker;
}
