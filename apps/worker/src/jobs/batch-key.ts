/**
 * Batch request key helpers (BACKFILL_BATCH_MODE). Pure — no db/queue imports —
 * so the tenant-isolation mapping is unit-testable in isolation.
 *
 * Key = workspaceId|emailThreadId[|step]. "|" separates parts because escalation
 * step strings contain ":". Results are mapped STRICTLY by parsed key (never by
 * order), and the parsed workspaceId is checked against the batch's owner.
 */
export function buildBatchKey(workspaceId: string, emailThreadId: string, step?: string): string {
  return step ? `${workspaceId}|${emailThreadId}|${step}` : `${workspaceId}|${emailThreadId}`;
}

export function parseBatchKey(key: string): { workspaceId: string; emailThreadId: string; step?: string } {
  const [workspaceId = "", emailThreadId = "", ...rest] = key.split("|");
  const step = rest.length > 0 ? rest.join("|") : undefined;
  return { workspaceId, emailThreadId, ...(step ? { step } : {}) };
}
