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
  //
  // It ALSO shows once ingestion is done if threads are still in flight on the
  // async Batch API (BACKFILL_BATCH_MODE) — those settle over hours, so the card
  // stays up (with batched-cadence copy) until they land.
  const scheduledThreads = syncInfo.backfillScheduledThreads ?? 0;
  const isRunning = syncInfo.backfillStatus === "RUNNING";
  if (!isRunning && scheduledThreads === 0) return null;

  // No count or percentage: Gmail exposes no reliable total for the backfill's
  // filtered/windowed/capped query, and a per-thread "loaded" count would sit at
  // zero during the (sometimes long) initial page fetch before any thread lands.
  // An indeterminate bar is honest and never misleads — it just signals activity.
  const awaitingTaxonomy = syncInfo.backfillAwaitingTaxonomy ?? false;
  // Batched cadence: threads arrive in waves over hours, not a live trickle. Show
  // this whenever batch work is queued (during or after ingestion).
  const batched = scheduledThreads > 0;

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
        <div className="em-backfill-title">
          {isRunning ? <Trans>Loading past threads…</Trans> : <Trans>Sorting your backlog…</Trans>}
        </div>
        <div className="em-backfill-desc">
          {awaitingTaxonomy ? (
            <Trans>Your past threads are being loaded and will appear shortly.</Trans>
          ) : batched ? (
            <Trans>Your backlog is being sorted in batches and will arrive over the next few hours.</Trans>
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
