"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 2 * 60 * 1_000; // 2 minutes

/**
 * Invisible component that calls router.refresh() every 5 s while `active`
 * is true. Stops automatically after 2 minutes and renders an error prompt
 * so the user isn't left polling forever if a classify job gets stuck.
 *
 * Mount it in a server page when one or more threads are being classified
 * so the UI updates without a manual reload.
 */
export function ClassifyingRefresher({ active }: { active: boolean }) {
  const router = useRouter();
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
  }, [active, router]);

  if (timedOut) {
    return (
      <div className="error-box" style={{ marginBottom: 16 }}>
        Sorting is taking longer than expected.{" "}
        <button
          onClick={() => {
            setTimedOut(false);
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
