"use client";

import { Trans } from "@lingui/react/macro";
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
          <span><Trans>Backfill</Trans></span>
        </div>
        <div className="em-backfill em-backfill--locked">
          <div className="em-backfill-title"><Trans>Bulk triage your inbox</Trans></div>
          <div className="em-backfill-desc">
            <Trans>
              Sort thousands of historical emails automatically. Available on Pro and Business subscriptions.
            </Trans>
          </div>
          <a href={upgradeHref} className="em-backfill-upgrade-btn">
            <Trans>Upgrade your subscription</Trans>
          </a>
        </div>
      </>
    );
  }

  if (syncInfo.backfillStatus !== "RUNNING") return null;

  // Fetching past threads from Gmail happens regardless of the taxonomy, so the
  // loading bar shows for the whole RUNNING phase. The taxonomy only gates
  // sorting, so it just adapts the subtext (and is also surfaced by the top
  // "build taxonomy" banner). Cap at 99% — the card clears when backfill is DONE.
  const awaitingTaxonomy = syncInfo.backfillAwaitingTaxonomy ?? false;
  const loaded = syncInfo.backfillLoadedThreads ?? 0;
  const total = syncInfo.backfillTotalThreads ?? 0;
  const percent = total > 0 ? Math.min(Math.round((loaded / total) * 100), 99) : 0;

  return (
    <>
      <div className="em-section-label">
        <span><Trans>Backfill</Trans></span>
      </div>
      <div className="em-backfill">
        <div className="em-backfill-eyebrow">
          <span className="em-pulse" />
          <Trans>Sorting historical inbox</Trans>
        </div>
        <div className="em-backfill-title"><Trans>Loading past threads…</Trans></div>
        <div className="em-backfill-desc">
          {awaitingTaxonomy ? (
            <Trans>Set up at least 3 folders so we can start sorting.</Trans>
          ) : (
            <Trans>New threads will appear as they are sorted.</Trans>
          )}
        </div>
        <div className="em-backfill-progress-track">
          <div className="em-backfill-progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="em-backfill-progress-label">{percent}%</div>
      </div>
    </>
  );
}
