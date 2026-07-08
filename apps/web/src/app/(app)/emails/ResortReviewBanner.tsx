"use client";

import { useEffect, useState } from "react";
import { Trans, Plural } from "@lingui/react/macro";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  /** Re-check eligibility whenever this changes (e.g. the review queue count). */
  refreshKey: number;
  /** Called after a re-sort is enqueued so the parent can refresh its threads. */
  onResorted: () => void;
};

/**
 * Offers a one-click re-sort of the NEEDS_REVIEW threads that can plausibly route
 * differently now — their plan changed since they were sorted, or their last sort
 * hit a transient error. Not every review thread qualifies, and the copy says so.
 * Self-fetches the eligible count and renders nothing when there is none.
 */
export function ResortReviewBanner({ workspaceId, refreshKey, onResorted }: Props) {
  const [eligible, setEligible] = useState(0);
  const [busy, setBusy] = useState(false);
  // Optimistic hide after a successful re-sort — the threads flip to PENDING and
  // leave the review queue; a later refresh re-fetches the true count.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHidden(false);
    api
      .needsReviewResortEligible(workspaceId)
      .then((r) => {
        if (!cancelled) setEligible(r.eligible);
      })
      .catch(() => {
        if (!cancelled) setEligible(0);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey]);

  if (hidden || eligible === 0) return null;

  async function handleResort() {
    setBusy(true);
    try {
      await api.rerouteNeedsReview(workspaceId);
      setHidden(true);
      onResorted();
    } catch {
      // non-fatal — user can retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="success-box"
      style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
    >
      <span suppressHydrationWarning>
        <Plural
          value={eligible}
          one="# needs-review thread can be re-sorted automatically, because your plan changed since it was sorted or sorting hit a temporary error."
          other="# needs-review threads can be re-sorted automatically, because your plan changed since they were sorted or sorting hit a temporary error."
        />
      </span>
      <button
        type="button"
        className="btn-primary"
        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        disabled={busy}
        onClick={handleResort}
      >
        {busy ? (
          <Trans>Re-sorting…</Trans>
        ) : (
          <Plural value={eligible} one="Re-sort # thread" other="Re-sort # threads" />
        )}
      </button>
    </div>
  );
}
