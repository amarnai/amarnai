import { Worker, UnrecoverableError } from "bullmq";
import { db, countRecurringThreadSorts } from "@amarnai/db";
import { config } from "@amarnai/config";
import { getThreadSortLimit, getDraftQuotaWindowStart } from "@amarnai/shared";
import {
  createAIProvider,
  createEmbeddingProvider,
  sortThreadByEmbedding,
  analyzeThreadTriage,
  classifyTriageByEmbedding,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  snapshotToThreadMessages,
  EmbeddingModelNotFoundError,
  LLMAuthenticationError,
} from "@amarnai/ai";
import type { EmbeddableNode, TriageMetadata, EmbeddingTriageResult, LlmCallMemoizer } from "@amarnai/ai";
import { GmailClient, GmailAuthError, normalizeGmailThread } from "@amarnai/gmail";
import {
  QUEUE_CLASSIFY_THREAD,
  type ClassifyThreadJobData,
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

      const [thread, connection] = await Promise.all([
        db.emailThread.findFirst({
          where: { id: emailThreadId, workspaceId },
          select: { providerThreadId: true },
        }),
        db.gmailConnection.findUnique({
          where: { workspaceId },
          select: { encryptedRefreshToken: true, oauthClient: true, status: true },
        }),
      ]);

      if (!thread) throw new Error(`EmailThread not found: ${emailThreadId}`);
      if (!connection || connection.status !== "ACTIVE") {
        console.log(
          `[classify-thread] Workspace ${workspaceId} has no active Gmail connection — skipping thread ${emailThreadId}`
        );
        return;
      }

      try {
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
        if (!triageOnly && config.billing.enforceThreadSortQuota && source !== "BACKFILL") {
          const workspace = await db.workspace.findUnique({
            where: { id: workspaceId },
            select: { plan: true },
          });
          if (workspace) {
            const limit = getThreadSortLimit(workspace.plan);
            const used = await countRecurringThreadSorts(
              workspaceId,
              getDraftQuotaWindowStart(),
              emailThreadId,
            );
            if (used >= limit) {
              console.log(
                `[classify-thread] Workspace ${workspaceId} at thread-sort quota (${used}/${limit}) — deferring thread ${emailThreadId} as QUOTA_BLOCKED`,
              );
              await db.emailThread.update({
                where: { id: emailThreadId },
                data: { triageStatus: "QUOTA_BLOCKED" },
              });
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

        const client = new GmailClient(connection.encryptedRefreshToken, connection.oauthClient);

        let rawThread: unknown;
        try {
          rawThread = await client.getThread(thread.providerThreadId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Thread deleted from Gmail after we enqueued the job — nothing to do.
          if (msg.includes("not found")) return;
          throw err;
        }

        const snapshot = normalizeGmailThread(rawThread);
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

          const rootNode = rawNodes.find((n) => n.isRoot);
          if (!isTaxonomyRoutable(rawNodes, rawEdges)) {
            // Taxonomy is not routable — leave the thread PENDING so stuck-thread
            // recovery re-enqueues it on the next sync cycle once taxonomy is set.
            // classifyingAt is cleared by the finally block.
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

          const threadText = buildThreadEmbeddingText(
            messages.map((m) => ({ subject: m.subject, bodyText: m.bodyText }))
          );

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

          // ── 7. Persist routing result + triage ────────────────────────────

          const { id: classificationId } = await db.emailClassification.create({
            data: {
              workspaceId,
              emailThreadId,
              finalNodeId: result.finalNodeId,
              confidence: result.confidence,
              explanation: result.explanation,
              needsHumanReview: result.needsHumanReview,
              source,
              decisionSource: result.decisionSource,
              modelProvider: aiProvider.providerName,
              modelName: aiProvider.modelName,
            },
            select: { id: true },
          });

          const isUnclassified = rootNode != null && result.finalNodeId === rootNode.id;
          const triageStatus = isUnclassified
            ? "UNCLASSIFIED"
            : result.needsHumanReview
              ? "NEEDS_REVIEW"
              : "SORTED";
          await db.emailThread.update({
            where: { id: emailThreadId },
            data: { triageStatus },
          });

          // ── 7b. Push notification — thread needs attention ────────────────
          //
          // Fire-and-forget on the existing sort-completion path: when a sort
          // lands on NEEDS_REVIEW the user has to make a call, so we nudge their
          // registered devices. Tenant-scoped + rate-limited inside the notifier.
          // Never awaited into the job result — a push failure must not fail or
          // retry classification (which is the source of truth).
          if (triageStatus === "NEEDS_REVIEW") {
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
        if (err instanceof GmailAuthError) {
          // Token is permanently invalid — mark the connection as disconnected
          // so all remaining queued jobs for this workspace skip immediately.
          console.error(
            `[classify-thread] Gmail auth failed for workspace ${workspaceId} — marking connection DISCONNECTED: ${err.message}`,
          );
          await db.gmailConnection
            .update({ where: { workspaceId }, data: { status: "DISCONNECTED" } })
            .catch(() => {});
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
  // worker process was killed). Clear classifyingAt here so the thread is not
  // stuck showing "Queued" in the UI indefinitely.
  worker.on("failed", (job, err) => {
    if (!job) return;
    const { workspaceId, emailThreadId } = job.data;
    console.error(
      `[classify-thread] Permanently failed for thread ${emailThreadId} (workspace ${workspaceId}) after ${job.attemptsMade} attempt(s):`,
      err,
    );
    void clearClassifyingAt(emailThreadId);
  });

  return worker;
}
