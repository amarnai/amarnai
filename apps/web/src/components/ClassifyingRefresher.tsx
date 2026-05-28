"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 5_000;
// Must be >= CLASSIFY_STALE_MS in the API (currently 15 min) so the poller
// does not give up while a job is legitimately waiting in a long Ollama queue.
const MAX_POLL_MS = 15 * 60 * 1_000; // 15 minutes

/**
 * Invisible component that calls router.refresh() every 5 s while `active`
 * is true. Stops automatically after 15 minutes and renders an error prompt
 * so the user isn't left polling forever if a classify job gets stuck.
 *
 * Mount it in a server page when one or more threads are being classified
 * so the UI updates without a manual reload.
 */
export function ClassifyingRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  // Bumping this key restarts the polling loop (e.g. after the user clicks
  // Refresh while the poller has timed out).
  const [pollKey, setPollKey] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active) {
      setTimedOut(false);
      return;
    }

    const pollId = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    const timeoutId = setTimeout(() => {
      clearInterval(pollId);
      setTimedOut(true);
    }, MAX_POLL_MS);

    return () => {
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  // pollKey is included so clicking Refresh restarts the interval + timeout.
  }, [active, router, pollKey]);

  if (timedOut) {
    return (
      <div className="error-box" style={{ marginBottom: 16 }}>
        Sorting is taking longer than expected.{" "}
        <button
          onClick={() => {
            setTimedOut(false);
            setPollKey((k) => k + 1);
            router.refresh();
          }}
        >
          Refresh
        </button>
      </div>
    );
  }

  return null;
}
