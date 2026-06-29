"use client";

import { Trans } from "@lingui/react/macro";
import type { SyncInfo } from "./types.js";

export interface BackfillCardProps {
  syncInfo: SyncInfo;
}

export function BackfillCard({ syncInfo }: BackfillCardProps) {
  if (!syncInfo) return null;

  // The card shows for the whole RUNNING phase, on every plan: fetching past
  // threads from Gmail happens regardless of plan or taxonomy. The taxonomy only
  // gates sorting, so it just adapts the subtext (and is also surfaced by the top
  // "build taxonomy" banner).
  if (syncInfo.backfillStatus !== "RUNNING") return null;

  // No count or percentage: Gmail exposes no reliable total for the backfill's
  // filtered/windowed/capped query, and a per-thread "loaded" count would sit at
  // zero during the (sometimes long) initial page fetch before any thread lands.
  // An indeterminate bar is honest and never misleads — it just signals activity.
  const awaitingTaxonomy = syncInfo.backfillAwaitingTaxonomy ?? false;

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
            <Trans>Your past threads are being loaded and will appear shortly.</Trans>
          ) : (
            <Trans>New threads will appear as they are sorted.</Trans>
          )}
        </div>
        <div className="em-backfill-progress-track">
          <div className="em-backfill-progress-bar em-backfill-progress-bar--indeterminate" />
        </div>
      </div>
    </>
  );
}
