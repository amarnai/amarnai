import Link from "next/link";
import type { SyncStatus } from "@/lib/api";

export function BackfillCard({ syncStatus }: { syncStatus: SyncStatus }) {
  if (!syncStatus) return null;

  if (syncStatus.workspacePlan === "FREE") {
    return (
      <>
        <div className="em-section-label" id="em-backfill-label">
          <span>Backfill</span>
        </div>
        <div className="em-backfill em-backfill--locked" id="em-backfill">
          <div className="em-backfill-title">Bulk triage your inbox</div>
          <div className="em-backfill-desc">
            Sort thousands of historical emails automatically. Available on Pro and Business plans.
          </div>
          <Link href="/upgrade" className="em-backfill-upgrade-btn">
            Upgrade to unlock
          </Link>
        </div>
      </>
    );
  }

  if (syncStatus.backfillStatus !== "RUNNING") return null;

  return (
    <>
      <div className="em-section-label" id="em-backfill-label">
        <span>Backfill</span>
      </div>
      <div className="em-backfill" id="em-backfill">
        <div className="em-backfill-eyebrow">
          <span className="em-pulse" />
          Sorting historical inbox
        </div>
        <div className="em-backfill-title">Sorting in progress…</div>
        <div className="em-backfill-desc">
          New threads will appear as they are sorted.
        </div>
      </div>
    </>
  );
}
