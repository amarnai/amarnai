import Link from "next/link";
import { requireUser, getOrCreateDefaultWorkspace } from "@/lib/session";
import { api, type EmailThreadDetail, type TaxonomyNode, type SyncStatus } from "@/lib/api";
import { ClassificationActions } from "./ClassificationActions";
import { TriageActions } from "./TriageActions";
import { MessageBody } from "./MessageBody";

type Props = { params: Promise<{ threadId: string }> };

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function priorityClass(priority: string | null): string {
  if (priority === "HIGH") return "badge-high";
  if (priority === "MEDIUM") return "badge-medium";
  if (priority === "LOW") return "badge-low";
  return "badge-none";
}

function PendingThreadBanner({
  triageStatus,
  syncStatus,
}: {
  triageStatus: EmailThreadDetail["triageStatus"];
  syncStatus: SyncStatus;
}) {
  if (triageStatus !== "PENDING") return null;

  const backfillStatus = syncStatus?.backfillStatus;

  if (backfillStatus === "RUNNING") {
    return (
      <div className="backfill-banner backfill-banner-running" style={{ marginBottom: 16 }}>
        ⏳ This thread will be sorted as part of the inbox backfill in progress.
      </div>
    );
  }

  if (backfillStatus === "PENDING") {
    return (
      <div className="backfill-banner backfill-banner-pending" style={{ marginBottom: 16 }}>
        This thread will be sorted automatically after the first sync.
      </div>
    );
  }

  // DONE, ERROR, or no sync state — prompt the user to sort manually.
  return (
    <div className="backfill-banner backfill-banner-pending" style={{ marginBottom: 16 }}>
      This thread hasn&apos;t been sorted yet — use the sort button below.
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div className="meta-value">{value ?? "—"}</div>
    </div>
  );
}

export default async function ThreadDetailPage({ params }: Props) {
  const { threadId } = await params;
  const user = await requireUser();
  const workspace = await getOrCreateDefaultWorkspace(user.id);
  const workspaceId = workspace.id;

  let thread: EmailThreadDetail | null = null;
  let nodes: TaxonomyNode[] = [];
  let syncStatus: SyncStatus = null;
  let error: string | null = null;

  try {
    [thread, nodes, syncStatus] = await Promise.all([
      api.emailThread(workspaceId, threadId),
      api.taxonomyNodes(workspaceId),
      api.syncStatus(workspaceId),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error || !thread) {
    return (
      <>
        <Link href="/emails" className="back-link">
          ← Back to Emails
        </Link>
        <div className="error-box">{error ?? "Thread not found"}</div>
      </>
    );
  }

  const cls = thread.latestClassification;

  return (
    <>
      <Link href="/emails" className="back-link">
        ← Back to Emails
      </Link>

      <h1>{thread.subject ?? "(no subject)"}</h1>

      <PendingThreadBanner triageStatus={thread.triageStatus} syncStatus={syncStatus} />

      {/* Triage actions — approve / move to node */}
      <TriageActions
        workspaceId={workspaceId}
        threadId={thread.id}
        triageStatus={thread.triageStatus}
        nodes={nodes}
      />

      {/* Retry classification */}
      <ClassificationActions
        workspaceId={workspaceId}
        threadId={thread.id}
        triageStatus={thread.triageStatus}
        hasClassification={thread.latestClassification !== null}
        modelProvider={thread.latestClassification?.modelProvider ?? null}
        modelName={thread.latestClassification?.modelName ?? null}
      />

      {/* Tags */}
      {thread.tags.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <div className="inline-tags">
            {thread.tags.map((et) => (
              <span
                key={et.id}
                className="tag-chip"
                style={
                  et.tag.color
                    ? { background: `${et.tag.color}28`, color: et.tag.color }
                    : {}
                }
              >
                {et.tag.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Classification */}
      {cls && (
        <div style={{ marginBottom: "28px" }}>
          <h2>Classification</h2>
          <div className="card card-body">
            <div className="meta-grid">
              <MetaItem label="Category" value={cls.finalNode?.name ?? "Unclassified"} />
              <MetaItem
                label="Confidence"
                value={`${Math.round(cls.confidence * 100)}%`}
              />
              <div>
                <div className="meta-label">Priority</div>
                <span className={`badge ${priorityClass(cls.priority)}`}>
                  {cls.priority}
                </span>
              </div>
              <MetaItem label="Urgency" value={cls.urgency} />
              <MetaItem label="Risk" value={cls.riskLevel} />
              <MetaItem label="Required action" value={cls.requiredAction} />
              <MetaItem label="Sensitivity" value={cls.sensitivity} />
              <MetaItem label="Next step" value={cls.suggestedNextStep} />
              {cls.dueAt && (
                <MetaItem
                  label="Due"
                  value={new Date(cls.dueAt).toLocaleDateString()}
                />
              )}
            </div>
            {cls.explanation && (
              <p
                style={{
                  borderTop: "1px solid var(--color-border-light)",
                  paddingTop: "12px",
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                }}
              >
                {cls.explanation}
              </p>
            )}
            {cls.needsHumanReview && (
              <p style={{ fontSize: 12, color: "var(--color-warning-text)", marginTop: "8px" }}>
                ⚠ Flagged for human review
              </p>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <h2>
        Messages ({thread.messageCount})
      </h2>
      {thread.messages.map((msg) => (
        <div key={msg.id} className="message-card">
          <div className="message-header">
            <span className="message-sender">
              {msg.senderName ?? msg.senderEmail}
              {msg.senderName && (
                <span
                  className="message-date"
                  style={{ fontWeight: "normal", marginLeft: "6px" }}
                >
                  &lt;{msg.senderEmail}&gt;
                </span>
              )}
            </span>
            <span className="message-date">{fmt(msg.receivedAt)}</span>
          </div>
          {msg.bodyText ? (
            <MessageBody bodyText={msg.bodyText} />
          ) : msg.snippet ? (
            <p className="message-snippet">{msg.snippet}</p>
          ) : null}
          {msg.hasAttachments && (
            <p style={{ marginTop: "8px", fontSize: 12, color: "var(--color-muted)" }}>
              📎 Has attachments
            </p>
          )}
        </div>
      ))}
    </>
  );
}
