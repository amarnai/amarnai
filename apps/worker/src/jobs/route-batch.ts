/**
 * `route-batch` worker (BACKFILL_BATCH_MODE).
 *
 * Runs the offline deferred-routing pass over a workspace's BatchThreadState rows
 * in ROUTING:
 *   1. Pre-warm stale node embeddings once (keeps the per-thread sort offline).
 *   2. Pass A (no Gmail): run the sorter with empty messages + the cached vector.
 *      Non-escalating threads finalize immediately; escalating ones are deferred.
 *   3. Pass B (escalating + already-answered threads only): re-fetch bodies from
 *      Gmail (§2b), enforce the content-consistency guard, then run the sorter
 *      with real messages + accumulated answers. Resolved → finalize; still
 *      escalating → add to the LLM batch.
 *
 * Idempotent on BatchThreadState.status: a retry re-processes only ROUTING rows.
 * Any failure path falls the affected threads back to the synchronous classify
 * path — a thread is never lost.
 */
import { Worker, type Job } from "bullmq";
import { db } from "@amarnai/db";
import {
  createEmbeddingProvider,
  createBatchProvider,
  getEmbeddingProviderConfig,
  getBatchProviderConfig,
  sortThreadByEmbedding,
  classifyTriageByEmbedding,
  buildThreadEmbeddingText,
  hashEmbeddingInput,
  snapshotToThreadMessages,
  createDeferredLlmContext,
  DeferLlmSignal,
  CENTERED_ROUTING_CONFIG,
} from "@amarnai/ai";
import type { EmbeddingProvider } from "@amarnai/ai";
import { GmailClient, GmailAuthError, normalizeGmailThread } from "@amarnai/gmail";
import { QUEUE_ROUTE_BATCH, type RouteBatchJobData } from "../queues.js";
import { redisConnection } from "../redis.js";
import { publishWorkspaceSynced } from "../redis-publisher.js";
import { finalizeRouting } from "./finalize-classification.js";
import {
  loadRoutableTaxonomy,
  prewarmNodeEmbeddings,
  fallbackThreadsToOnline,
  type RoutableTaxonomy,
} from "./batch-routing-helpers.js";
import { submitLlmBatch, type LlmBatchRequest } from "./submit-llm-batch.js";

type ThreadRow = {
  id: string;
  providerThreadId: string;
  subject: string | null;
  isAutomated: boolean;
};

type WorkState = {
  emailThreadId: string;
  threadVector: number[];
  bodyHash: string | null;
  messageCount: number;
  llmAnswers: Record<string, string>;
};

export function createRouteBatchWorker(): Worker {
  const worker = new Worker<RouteBatchJobData>(
    QUEUE_ROUTE_BATCH,
    async (job) => {
      const { workspaceId, emailAccountId } = job.data;
      const tag = `[route-batch] ws=${workspaceId}`;

      const states = await db.batchThreadState.findMany({
        where: { workspaceId, status: "ROUTING" },
        select: {
          emailThreadId: true,
          threadVector: true,
          bodyHash: true,
          messageCount: true,
          llmAnswers: true,
        },
      });
      if (states.length === 0) {
        console.log(`${tag} no ROUTING threads — nothing to do`);
        return;
      }
      console.log(`${tag} routing ${states.length} thread(s)`);

      const tax = await loadRoutableTaxonomy(workspaceId);
      if (!tax) {
        // Taxonomy became unroutable mid-flight — send everything to the online
        // path (it will leave them PENDING as the bulk backlog).
        console.warn(`${tag} taxonomy not routable — falling ${states.length} thread(s) back online`);
        await fallbackThreadsToOnline(workspaceId, states.map((s) => s.emailThreadId));
        return;
      }

      const embeddingProvider = createEmbeddingProvider(getEmbeddingProviderConfig());
      await prewarmNodeEmbeddings(tax.nodes, tax.edges, embeddingProvider);

      const batchProvider = createBatchProvider(getBatchProviderConfig());
      const [syncSettings, threadRows] = await Promise.all([
        db.gmailSyncSettings.findUnique({ where: { workspaceId }, select: { routeBulkToOther: true } }),
        db.emailThread.findMany({
          where: { id: { in: states.map((s) => s.emailThreadId) }, workspaceId },
          select: { id: true, providerThreadId: true, subject: true, isAutomated: true },
        }),
      ]);
      const rowById = new Map<string, ThreadRow>(threadRows.map((r) => [r.id, r]));
      const routeBulk = (row: ThreadRow) => row.isAutomated && (syncSettings?.routeBulkToOther ?? true);

      const finalize = async (row: ThreadRow, result: Awaited<ReturnType<typeof sortThreadByEmbedding>>, vector: number[]) => {
        const triage =
          vector.length > 0
            ? await classifyTriageByEmbedding(vector, embeddingProvider).catch(() => null)
            : null;
        await finalizeRouting({
          workspaceId,
          emailThreadId: row.id,
          result,
          nodes: tax.nodes,
          rootNodeId: tax.rootNodeId,
          routeBulkAutomated: routeBulk(row),
          source: "BACKFILL",
          modelProvider: batchProvider.providerName,
          modelName: batchProvider.llmModelName,
          embeddingTriage: triage,
          subject: row.subject,
        });
        await db.batchThreadState.update({ where: { emailThreadId: row.id }, data: { status: "DONE" } });
      };

      // ── Pass A: cheaply detect escalation for round-0 threads (no Gmail) ──────
      const needsLlm: WorkState[] = [];
      for (const s of states) {
        const row = rowById.get(s.emailThreadId);
        if (!row) continue;
        const work: WorkState = {
          emailThreadId: s.emailThreadId,
          threadVector: s.threadVector,
          bodyHash: s.bodyHash,
          messageCount: s.messageCount,
          llmAnswers: (s.llmAnswers as Record<string, string>) ?? {},
        };
        if (Object.keys(work.llmAnswers).length > 0) {
          // Already escalated in a prior round → needs the real-message pass.
          needsLlm.push(work);
          continue;
        }
        const ctx = createDeferredLlmContext(new Map());
        try {
          const result = await runSort(embeddingProvider, ctx, tax, [], work.threadVector, routeBulk(row));
          await finalize(row, result, work.threadVector);
        } catch (err) {
          if (err instanceof DeferLlmSignal) needsLlm.push(work);
          else throw err;
        }
      }
      console.log(`${tag} pass A: ${states.length - needsLlm.length} finalized, ${needsLlm.length} need LLM`);

      // ── Pass B: re-fetch bodies + run with real messages + answers ────────────
      if (needsLlm.length > 0) {
        const connection = await db.gmailConnection.findUnique({
          where: { workspaceId },
          select: { encryptedRefreshToken: true, status: true },
        });
        if (!connection || connection.status !== "ACTIVE") {
          console.warn(`${tag} no active Gmail connection — falling ${needsLlm.length} escalating thread(s) back online`);
          await fallbackThreadsToOnline(workspaceId, needsLlm.map((w) => w.emailThreadId));
        } else {
          const client = new GmailClient(connection.encryptedRefreshToken);
          const llmRequests: LlmBatchRequest[] = [];
          const changedOrGone: string[] = [];

          for (const work of needsLlm) {
            const row = rowById.get(work.emailThreadId);
            if (!row) continue;
            let raw: unknown;
            try {
              raw = await client.getThread(row.providerThreadId);
            } catch (err) {
              if (err instanceof GmailAuthError) throw err;
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes("not found")) {
                changedOrGone.push(work.emailThreadId);
                continue;
              }
              throw err;
            }
            const snapshot = normalizeGmailThread(raw);
            if (snapshot.messages.length === 0) {
              changedOrGone.push(work.emailThreadId);
              continue;
            }
            const messages = snapshotToThreadMessages(snapshot);

            // §2b consistency guard: content must match ingestion (T0).
            const liveText = buildThreadEmbeddingText(
              messages.map((m) => ({
                subject: m.subject,
                bodyText: m.bodyText,
                ...(m.attachmentNames?.length ? { attachmentNames: m.attachmentNames } : {}),
              })),
            );
            const liveHash = hashEmbeddingInput(liveText, "thread-body");
            if (snapshot.messageCount !== work.messageCount || liveHash !== work.bodyHash) {
              changedOrGone.push(work.emailThreadId);
              continue;
            }

            const ctx = createDeferredLlmContext(new Map(Object.entries(work.llmAnswers)));
            try {
              const result = await runSort(embeddingProvider, ctx, tax, messages, work.threadVector, routeBulk(row));
              await finalize(row, result, work.threadVector);
            } catch (err) {
              if (err instanceof DeferLlmSignal) {
                for (const r of ctx.pending) {
                  llmRequests.push({ emailThreadId: row.id, step: r.step, system: r.system, user: r.user });
                }
              } else throw err;
            }
          }

          const resolvedInB = needsLlm.length - changedOrGone.length - llmRequests.length;
          console.log(
            `${tag} pass B: ${resolvedInB} resolved, ${changedOrGone.length} changed/deleted→online, ${llmRequests.length} escalated→LLM batch`,
          );
          if (changedOrGone.length > 0) await fallbackThreadsToOnline(workspaceId, changedOrGone);
          if (llmRequests.length > 0) {
            await submitLlmBatch({ workspaceId, emailAccountId, requests: llmRequests, now: new Date() });
          }
        }
      }

      publishWorkspaceSynced(workspaceId).catch(() => {});
    },
    { connection: redisConnection, concurrency: 3 },
  );

  // Permanent failure: don't strand the workspace's ROUTING threads — fall them
  // back to the synchronous path so they still get sorted.
  worker.on("failed", (job: Job<RouteBatchJobData> | undefined, err: Error) => {
    if (!job) return;
    // Only act once retries are exhausted — "failed" can fire per attempt.
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const { workspaceId } = job.data;
    console.error(
      `[route-batch] ws=${workspaceId} permanently failed after ${job.attemptsMade} attempt(s): ${err.message}`,
    );
    void (async () => {
      const stuck = await db.batchThreadState
        .findMany({ where: { workspaceId, status: "ROUTING" }, select: { emailThreadId: true } })
        .catch(() => []);
      if (stuck.length > 0) {
        await fallbackThreadsToOnline(workspaceId, stuck.map((s) => s.emailThreadId)).catch(() => {});
      }
    })();
  });

  return worker;
}

/** Run the deferred-mode sorter with the production routing config. */
function runSort(
  embeddingProvider: EmbeddingProvider,
  ctx: ReturnType<typeof createDeferredLlmContext>,
  tax: RoutableTaxonomy,
  messages: Parameters<typeof sortThreadByEmbedding>[4],
  vector: number[],
  suppressLlmEscalation: boolean,
) {
  return sortThreadByEmbedding(embeddingProvider, ctx.llmProvider, tax.nodes, tax.edges, messages, {
    precomputedThreadVector: vector,
    llmMemoizer: ctx.llmMemoizer,
    ...CENTERED_ROUTING_CONFIG,
    // Must stay false so a DeferLlmSignal propagates out instead of becoming an
    // inbox fallback.
    failOpenOnLlmError: false,
    suppressLlmEscalation,
  });
}
