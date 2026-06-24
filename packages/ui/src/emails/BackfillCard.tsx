"use client";

import type { SyncInfo } from "./types.js";

export interface BackfillCardProps {
  syncInfo: SyncInfo;
  upgradeHref?: string | undefined;
}

export function BackfillCard({ syncInfo, upgradeHref = "#" }: BackfillCardProps) {
  if (!syncInfo) return null;

  if (syncInfo.workspacePlan === "FREE") {
    return (
      <>
        <div className="em-section-label">
          <span>Backfill</span>
        </div>
        <div className="em-backfill em-backfill--locked">
          <div className="em-backfill-title">Bulk triage your inbox</div>
          <div className="em-backfill-desc">
            Sort thousands of historical emails automatically. Available on Pro and Business plans.
          </div>
          <a href={upgradeHref} className="em-backfill-upgrade-btn">
            Upgrade your plan
          </a>
        </div>
      </>
    );
  }

  if (syncInfo.backfillStatus !== "RUNNING") return null;

  const awaitingTaxonomy = syncInfo.backfillAwaitingTaxonomy ?? false;
  const sorted = syncInfo.backfillSortedThreads ?? 0;
  const total = syncInfo.backfillTotalThreads ?? 0;
  // Cap at 99% while RUNNING: the card only clears once the backfill reaches DONE.
  const percent = total > 0 ? Math.min(Math.round((sorted / total) * 100), 99) : 0;
  // "Sorting in progress" is only honest once threads have actually been sorted.
  // Until then the backfill is still discovering threads from Gmail.
  const sorting = sorted > 0;

  return (
    <>
      <div className="em-section-label">
        <span>Backfill</span>
      </div>
      <div className="em-backfill">
        <div className="em-backfill-eyebrow">
          <span className="em-pulse" />
          Sorting historical inbox
        </div>
        {awaitingTaxonomy ? (
          <>
            <div className="em-backfill-title">Waiting for a valid taxonomy</div>
            <div className="em-backfill-desc">
              Set up at least 3 folders to start sorting your threads.
            </div>
          </>
        ) : sorting ? (
          <>
            <div className="em-backfill-title">Sorting in progress…</div>
            <div className="em-backfill-desc">New threads will appear as they are sorted.</div>
            <div className="em-backfill-progress-track">
              <div className="em-backfill-progress-bar" style={{ width: `${percent}%` }} />
            </div>
            <div className="em-backfill-progress-label">{percent}%</div>
          </>
        ) : (
          <>
            <div className="em-backfill-title">Scanning your inbox…</div>
            <div className="em-backfill-desc">Finding historical threads to sort.</div>
          </>
        )}
      </div>
    </>
  );
}
