"use client";

import { Trans, Plural } from "@lingui/react/macro";
import type { SyncStatus } from "../types.js";

// Whether Aziru is busy, above the queue.
//
// Only shown while something is actually happening, because the ordinary state
// of a sorted inbox is that nothing is, and a permanent bar reporting "all
// done" is furniture. Two things can be happening, and they are reported
// differently:
//
//   Sorting    threads already in Aziru are being routed. There is a count,
//              and it falls, which is the progress signal.
//   Backfill   past threads are still being pulled out of the mailbox. No
//              count is possible — the provider exposes no total for the
//              filtered query — so this says what is happening and no more.
//
// Both bars are indeterminate. A percentage needs a stable denominator and
// there is none: new mail arriving mid-sort would make a determinate bar walk
// backwards, and the panel is remounted too often to latch a high-water mark.
//
// The markup is the web app's `em-backfill` block, not a copy of it. Both hosts
// already load that stylesheet, and the extension's own status slot reuses it
// the same way, so the three surfaces cannot drift apart visually.

export type SortingStripProps = {
  syncStatus: SyncStatus | null;
  pendingCount: number;
  pendingWaitingCount: number;
};

export function SortingStrip({
  syncStatus,
  pendingCount,
  pendingWaitingCount,
}: SortingStripProps) {
  // A pending thread with no classify job yet is waiting, not being sorted.
  const inFlight = Math.max(0, pendingCount - pendingWaitingCount);

  if (inFlight > 0) {
    return (
      <div className="apn-strip">
        <div className="em-backfill">
          <div className="em-backfill-eyebrow">
            <span className="em-pulse" />
            <Trans>Sorting</Trans>
          </div>
          <div className="em-backfill-title">
            <Plural value={inFlight} one="Sorting # thread…" other="Sorting # threads…" />
          </div>
          <div className="em-backfill-progress-track">
            <div className="em-backfill-progress-bar em-backfill-progress-bar--indeterminate" />
          </div>
        </div>
      </div>
    );
  }

  if (syncStatus?.backfillStatus !== "RUNNING") return null;

  // Same strings as the side panel's backfill state, deliberately: one phrasing
  // for one situation, and one catalog key for translators.
  return (
    <div className="apn-strip">
      <div className="em-backfill">
        <div className="em-backfill-eyebrow">
          <span className="em-pulse" />
          <Trans>Sorting historical inbox</Trans>
        </div>
        <div className="em-backfill-title">
          <Trans>Loading past threads…</Trans>
        </div>
        <div className="em-backfill-desc">
          {syncStatus.backfillAwaitingTaxonomy ? (
            <Trans>Your past threads are being loaded and will appear shortly.</Trans>
          ) : (
            <Trans>New threads will appear as they are sorted.</Trans>
          )}
        </div>
        <div className="em-backfill-progress-track">
          <div className="em-backfill-progress-bar em-backfill-progress-bar--indeterminate" />
        </div>
      </div>
    </div>
  );
}
