"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { TAXONOMY_MIN_NON_ROOT_NODES } from "@amarnai/shared";
import { GenerateFromInboxButton } from "../taxonomy/GenerateFromInboxButton";
import { importTaxonomyAction } from "@/actions/taxonomy";

type Props = {
  workspaceId: string;
  waitingCount: number;
  routableNodeCount: number;
  onRouted: () => void;
};

export function UnroutedBanner({ workspaceId, waitingCount, routableNodeCount, onRouted }: Props) {
  const [routing, setRouting] = useState(false);
  const router = useRouter();

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
          {waitingCount} thread{waitingCount !== 1 ? "s are" : " is"} waiting to be routed.
          Set up your folders to begin sorting: generate them from your inbox, or start from a template.
        </span>
        <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <GenerateFromInboxButton
            workspaceId={workspaceId}
            disabled={false}
            onApply={async (file) => {
              await importTaxonomyAction(workspaceId, file);
              onRouted();
              router.refresh();
            }}
            onUseTemplates={() => router.push("/taxonomy")}
          />
          <Link href="/taxonomy" className="btn-primary" style={{ whiteSpace: "nowrap" }}>
            Choose a template
          </Link>
        </span>
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
