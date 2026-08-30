import { db } from "@aziru/db";

type AuditEntry = {
  workspaceId: string;
  actorType: "USER" | "AI" | "SYSTEM";
  actorUserId?: string | null;
  eventType: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Writes an audit log entry. Best-effort: failures are logged but never
 * propagated so a failed audit never breaks the caller.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorType: entry.actorType,
        actorUserId: entry.actorUserId ?? null,
        eventType: entry.eventType,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as Record<string, never>,
      },
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err instanceof Error ? err.message : err);
  }
}
