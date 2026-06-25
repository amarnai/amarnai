"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { TAXONOMY_MIN_NON_ROOT_NODES } from "@amarnai/shared";

type Props = {
  workspaceId: string;
  waitingCount: number;
  routableNodeCount: number;
  onRouted: () => void;
};

export function UnroutedBanner({ workspaceId, waitingCount, routableNodeCount, onRouted }: Props) {
  const [routing, setRouting] = useState(false);

  if (waitingCount === 0) return null;

  const taxonomyWeak = routableNodeCount < TAXONOMY_MIN_NON_ROOT_NODES;

  async function handleRouteNow() {
    setRouting(true);
    try {
      await api.routeUnrouted(workspaceId);
      onRouted();
    } catch {
      // non-fatal — user can retry
    } finally {
      setRouting(false);
    }
  }

  if (taxonomyWeak) {
    return (
      <div className="warning-box" style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span suppressHydrationWarning>
          {waitingCount} thread{waitingCount !== 1 ? "s are" : " is"} waiting to be routed. Set up your folders to start sorting.
        </span>
        <a href="/taxonomy?openGenerate=1" className="btn-primary" style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M3 1.5L3.7 3.3L5.5 4L3.7 4.7L3 6.5L2.3 4.7L0.5 4L2.3 3.3ZM9.5 5L10.6 7.9L13.5 9L10.6 10.1L9.5 13L8.4 10.1L5.5 9L8.4 7.9Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          Generate from inbox
        </a>
      </div>
    );
  }

  return (
    <div
      className="success-box"
      style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
    >
      <span suppressHydrationWarning>
        {waitingCount} thread{waitingCount !== 1 ? "s are" : " is"} ready to route.
      </span>
      <button
        type="button"
        className="btn-primary"
        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        disabled={routing}
        onClick={handleRouteNow}
      >
        {routing ? "Routing…" : "Route now"}
      </button>
    </div>
  );
}
