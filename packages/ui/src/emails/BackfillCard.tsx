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

  const processed = syncInfo.backfillProcessedCount ?? 0;
  const total = syncInfo.backfillTotal ?? 1;
  const percent = Math.min(Math.round((processed / total) * 100), 99);
  const awaitingTaxonomy = syncInfo.backfillAwaitingTaxonomy ?? false;

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
        ) : (
          <>
            <div className="em-backfill-title">Sorting in progress…</div>
            <div className="em-backfill-desc">New threads will appear as they are sorted.</div>
          </>
        )}
        <div className="em-backfill-progress-track">
          <div className="em-backfill-progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="em-backfill-progress-label">{percent}%</div>
      </div>
    </>
  );
}
