import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSelectedWorkspace } from "@/lib/workspace";
import { api, type EmailThreadDetail, type TaxonomyNode, type SyncStatus } from "@/lib/api";
import { ClassificationActions } from "./ClassificationActions";
import { TriageActions } from "./TriageActions";
import { MessageBody } from "./MessageBody";
import { ClassifyingRefresher } from "@/components/ClassifyingRefresher";

type Props = { params: Promise<{ threadId: string }> };

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// priorityClass — post-MVP, requires LLM triage
// function priorityClass(priority: string | null): string {
//   if (priority === "HIGH") return "badge-high";
//   if (priority === "MEDIUM") return "badge-medium";
//   if (priority === "LOW") return "badge-low";
//   return "badge-none";
// }

function ClassifyingBanner({ hasClassification }: { hasClassification: boolean }) {
  return (
    <div className="classifying-banner">
      <span className="classifying-dot" />
      {hasClassification
        ? "Analyzing this thread — actions and sensitivity will appear shortly."
        : "Sorting this thread right now — results will appear shortly."}
    </div>
  );
}

function ThreadStatusBanner({
  triageStatus,
  syncStatus,
  hasClassification,
  isQueued,
}: {
  triageStatus: EmailThreadDetail["triageStatus"];
  syncStatus: SyncStatus;
  hasClassification: boolean;
  isQueued: boolean;
}) {
  if (triageStatus === "SORTED") {
    return (
      <div className="backfill-banner backfill-banner-success" style={{ marginBottom: 16 }}>
        ✓ Thread sorted.
      </div>
    );
  }

  if (triageStatus === "NEEDS_REVIEW") {
    return (
      <div className="backfill-banner backfill-banner-warning" style={{ marginBottom: 16 }}>
        ⚠ This thread is flagged for human review.
      </div>
    );
  }

  // PENDING — check whether a classify job is already enqueued.
  if (isQueued) {
    return (
      <div className="backfill-banner backfill-banner-running" style={{ marginBottom: 16 }}>
        ⏳ This thread is queued for sorting and will be processed automatically.
      </div>
    );
  }

  // PENDING, not queued — show context-aware message based on backfill state.
  const backfillStatus = syncStatus?.backfillStatus;

  if (backfillStatus === "PENDING") {
    return (
      <div className="backfill-banner backfill-banner-pending" style={{ marginBottom: 16 }}>
        This thread will be sorted automatically after the first sync.
      </div>
    );
  }

  // Backfill is DONE, ERROR, or absent — no job in flight.
  // Only prompt to sort if there is genuinely no classification yet.
  if (hasClassification) return null;

  return (
    <div className="backfill-banner backfill-banner-warning" style={{ marginBottom: 16 }}>
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
  const workspace = await getSelectedWorkspace(user.id);
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

      <ClassifyingRefresher active={thread.isClassifying} />

      <h1>{thread.subject ?? "(no subject)"}</h1>

      {thread.isClassifying
        ? <ClassifyingBanner hasClassification={thread.latestClassification !== null} />
        : <ThreadStatusBanner triageStatus={thread.triageStatus} syncStatus={syncStatus} hasClassification={cls !== null} isQueued={thread.isQueued} />
      }

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
        isClassifying={thread.isClassifying}
        isQueued={thread.isQueued}
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
              {/* priority — post-MVP, requires LLM triage */}
              {/* <div>
                <div className="meta-label">Priority</div>
                <span className={`badge ${priorityClass(cls.priority)}`}>
                  {cls.priority}
                </span>
              </div> */}
              {/* urgency — post-MVP, requires LLM triage */}
              {/* <MetaItem label="Urgency" value={cls.urgency} /> */}
              {/* riskLevel — post-MVP, requires LLM triage */}
              {/* <MetaItem label="Risk" value={cls.riskLevel} /> */}
              <MetaItem label="Required action" value={cls.requiredAction} />
              <MetaItem label="Sensitivity" value={cls.sensitivity} />
              <MetaItem label="Next step" value={cls.suggestedNextStep} />
              {/* dueAt — post-MVP, requires LLM triage */}
              {/* {cls.dueAt && (
                <MetaItem
                  label="Due"
                  value={new Date(cls.dueAt).toLocaleDateString()}
                />
              )} */}
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
