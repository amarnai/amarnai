/**
 * Shared routing-finalization used by BOTH classify-thread (synchronous path)
 * and route-batch (BACKFILL_BATCH_MODE). Given an embedding sort `result`, it
 * applies the automated-mail catch-all policy, persists the EmailClassification
 * + node-embedding cache + embedding triage, sets the thread's triageStatus, and
 * fires the needs-attention push. Extracted so the batch path never forks this
 * logic (CLAUDE.md: do not duplicate logic).
 */
import { db } from "@amarnai/db";
import { buildRoutingTelemetry, CENTERED_ROUTING_CONFIG } from "@amarnai/ai";
import type { EmbeddingSortResult, EmbeddableNode, EmbeddingTriageResult } from "@amarnai/ai";
import { notifyThreadNeedsAttention } from "../notifications/notify-threads.js";

export type FinalizeRoutingArgs = {
  workspaceId: string;
  emailThreadId: string;
  result: EmbeddingSortResult;
  /** Routable nodes used by the sort (catch-all lookup). */
  nodes: EmbeddableNode[];
  rootNodeId: string | null;
  /** True when bulk/automated mail; enables the zero-LLM catch-all safety net. */
  routeBulkAutomated: boolean;
  source: "LIVE" | "BACKFILL" | "REROUTE" | "MANUAL";
  modelProvider: string;
  modelName: string;
  embeddingTriage: EmbeddingTriageResult | null;
  /** Subject for the needs-attention push (null skips the subject line). */
  subject: string | null;
};

export type FinalizeRoutingResult = {
  triageStatus: "SORTED" | "NEEDS_REVIEW" | "UNCLASSIFIED";
  finalNodeId: string | null;
};

export async function finalizeRouting(args: FinalizeRoutingArgs): Promise<FinalizeRoutingResult> {
  const {
    workspaceId,
    emailThreadId,
    result,
    nodes,
    rootNodeId,
    routeBulkAutomated,
    source,
    modelProvider,
    modelName,
    embeddingTriage,
    subject,
  } = args;

  // ── Persist updated node embedding cache (stale nodes refreshed during sort) ──
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

  // ── Automated-mail policy (embedding safety net) ──────────────────────────────
  // LLM was suppressed for bulk/automated threads; if embeddings did not
  // confidently place the thread (anything other than embedding_auto), file it in
  // the catch-all folder at zero LLM cost rather than leaving it for review.
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

  // ── Persist routing result ────────────────────────────────────────────────────
  const { id: classificationId } = await db.emailClassification.create({
    data: {
      workspaceId,
      emailThreadId,
      finalNodeId,
      confidence,
      explanation,
      needsHumanReview,
      source,
      decisionSource,
      modelProvider,
      modelName,
      rawOutput: buildRoutingTelemetry(result, CENTERED_ROUTING_CONFIG.thetaMin),
    },
    select: { id: true },
  });

  const isUnclassified = rootNodeId != null && finalNodeId === rootNodeId;
  const triageStatus = isUnclassified ? "UNCLASSIFIED" : needsHumanReview ? "NEEDS_REVIEW" : "SORTED";
  await db.emailThread.update({
    where: { id: emailThreadId },
    data: { triageStatus, classifyFailedAt: null, classifyAttempts: 0 },
  });

  // ── Push notification — thread needs attention ────────────────────────────────
  // Suppressed on an LLM-error fail-open so a provider outage cannot push-storm.
  if (result.failedOpenOnError) {
    console.warn(
      `[finalize] workspace=${workspaceId} thread=${emailThreadId} fail-open to review on LLM error — suppressing needs-attention push`,
    );
  }
  if (triageStatus === "NEEDS_REVIEW" && !result.failedOpenOnError) {
    void notifyThreadNeedsAttention({ workspaceId, emailThreadId, subject }).catch((err) => {
      console.error(
        `[finalize] Push notify failed for thread ${emailThreadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ── Embedding triage ──────────────────────────────────────────────────────────
  if (embeddingTriage !== null) {
    await db.emailClassification.update({
      where: { id: classificationId },
      data: {
        sensitivity: embeddingTriage.sensitivity,
        requiredAction: embeddingTriage.requiredAction,
        suggestedNextStep: embeddingTriage.suggestedNextStep,
      },
    });
  }

  return { triageStatus, finalNodeId };
}
