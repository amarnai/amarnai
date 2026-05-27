"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { TaxonomyNode, FilterCounts } from "@/lib/api";

export type { FilterCounts };

type Props = {
  nodes: TaxonomyNode[];
  counts: FilterCounts;
};

type StatusOption = { label: string; value: string };

const STATUS_OPTIONS: StatusOption[] = [
  { label: "All", value: "" },
  { label: "Pending", value: "PENDING" },
  { label: "Needs Review", value: "NEEDS_REVIEW" },
  { label: "Sorted", value: "SORTED" },
];

function pillCount(value: string, counts: FilterCounts): number {
  if (value === "") return counts.total;
  return counts[value as keyof Omit<FilterCounts, "total">] ?? 0;
}

export function ThreadFilters({ nodes, counts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentStatus = searchParams.get("status") ?? "";
  const currentNodeId = searchParams.get("nodeId") ?? "";

  // Non-root nodes are the leaf categories threads can be sorted into.
  const leafNodes = nodes.filter((n) => !n.isRoot);

  // Changing a filter always resets to page 1 (no cursor).
  function navigate(status: string, nodeId: string) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (nodeId) params.set("nodeId", nodeId);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleStatusClick(value: string) {
    navigate(value, currentNodeId);
  }

  function handleNodeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    navigate(currentStatus, e.target.value);
  }

  return (
    <div className="thread-filters">
      <div className="thread-filter-pills">
        {STATUS_OPTIONS.map(({ label, value }) => {
          const count = pillCount(value, counts);
          return (
            <button
              key={value}
              type="button"
              className={`filter-pill${currentStatus === value ? " filter-pill-active" : ""}`}
              onClick={() => handleStatusClick(value)}
            >
              {label}
              {count > 0 && <span className="filter-pill-count">({count})</span>}
            </button>
          );
        })}
      </div>
      {leafNodes.length > 0 && (
        <select
          className="triage-select"
          value={currentNodeId}
          onChange={handleNodeChange}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {leafNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
