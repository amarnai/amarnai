import type { SyncStatus } from "@/lib/api";

export function BackfillCard({ syncStatus }: { syncStatus: SyncStatus }) {
  if (syncStatus?.backfillStatus !== "RUNNING") return null;

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
