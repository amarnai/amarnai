"use client";

import { useState } from "react";
import Link from "next/link";
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
      <div className="warning-box" style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span suppressHydrationWarning>
          {waitingCount} thread{waitingCount !== 1 ? "s are" : " is"} waiting to be routed.
          Connect at least {TAXONOMY_MIN_NON_ROOT_NODES} categories to your inbox to begin sorting.
        </span>
        <Link href="/taxonomy" className="btn-primary" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
          Build taxonomy
        </Link>
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
