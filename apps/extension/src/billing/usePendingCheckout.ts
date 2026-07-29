import { useCallback, useEffect, useRef, useState } from "react";
import { confirmCheckout } from "./api";
import { setPendingCheckout, getPendingCheckout, clearPendingCheckout } from "./pendingCheckout";

/**
 * How often to ask whether an outstanding checkout has completed. Each poll is a
 * round trip that retrieves the session from Stripe, so this is deliberately
 * unhurried: the user is in another tab typing card details, not waiting on us.
 */
const POLL_MS = 5000;

/**
 * Give up polling after five minutes. Not a deadline on the checkout itself:
 * the marker survives, and the focus trigger plus the next panel open still
 * confirm it. This only stops an abandoned checkout from polling Stripe for the
 * marker's full hour-long lifetime.
 */
const MAX_ATTEMPTS = 60;

/** What the confirmed checkout actually bought. */
export type ProvisionedCheckout = {
  /** BillingPlan value, e.g. "BUSINESS". */
  plan: string;
  /**
   * The workspace the plan landed on. Not necessarily the one the user is
   * looking at: a checkout can create a workspace of its own.
   */
  workspaceId: string;
};

export type PendingCheckoutResult = {
  /** Record a checkout the user has been sent off to complete, and start watching it. */
  start: (sessionId: string) => Promise<void>;
  /** Confirm now, regardless of the poll schedule (used by the focus handler). */
  confirmNow: () => Promise<void>;
};

/**
 * Watches a Stripe checkout the user was sent to a tab to complete, and confirms
 * it as soon as it lands so the new plan applies without waiting on the webhook.
 *
 * Polls rather than relying on the panel regaining focus. A Chrome side panel
 * stays open and visible while the user moves between browser tabs, so coming
 * back from the checkout tab does not reliably fire `focus` or
 * `visibilitychange` on this document; hanging the only confirmation on those
 * events left the panel showing a stale plan until the user happened to click
 * into it.
 */
export function usePendingCheckout({
  onProvisioned,
}: {
  /** The upgrade landed. The host re-reads whatever it derived from the plan. */
  onProvisioned: (result: ProvisionedCheckout) => void;
}): PendingCheckoutResult {
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Held in a ref so the polling effect does not restart every time the host
  // re-renders with a new callback identity.
  const onProvisionedRef = useRef(onProvisioned);
  useEffect(() => {
    onProvisionedRef.current = onProvisioned;
  }, [onProvisioned]);

  // The panel is destroyed when closed, so a checkout started before a reopen
  // exists only in storage. Pick it back up on mount.
  useEffect(() => {
    let cancelled = false;
    void getPendingCheckout().then((stored) => {
      if (!cancelled && stored) setSessionId(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmNow = useCallback(async () => {
    const stored = await getPendingCheckout();
    if (!stored) {
      setSessionId(null);
      return;
    }

    const res = await confirmCheckout(stored).catch(() => null);
    // A failed round trip says nothing about the checkout; keep watching.
    if (!res) return;
    // Payment is not finished yet. Leave the marker and try again.
    if (res.ok && res.data.pending) return;

    await clearPendingCheckout();
    setSessionId(null);
    if (res.ok && res.data.provisioned) {
      onProvisionedRef.current({
        plan: res.data.plan ?? "",
        workspaceId: res.data.workspaceId ?? "",
      });
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let attempts = 0;
    const handle = setInterval(() => {
      attempts += 1;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(handle);
        return;
      }
      void confirmNow();
    }, POLL_MS);

    return () => clearInterval(handle);
  }, [sessionId, confirmNow]);

  const start = useCallback(async (id: string) => {
    await setPendingCheckout(id);
    setSessionId(id);
  }, []);

  return { start, confirmNow };
}
