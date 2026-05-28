"use client";

import { useTransition } from "react";
import { pauseSortingAction, resumeSortingAction } from "@/actions/gmail";

type Props = {
  workspaceId: string;
  sortingPaused: boolean;
};

export function SortingQueueControl({ workspaceId, sortingPaused }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      if (sortingPaused) {
        await resumeSortingAction(workspaceId);
      } else {
        await pauseSortingAction(workspaceId);
      }
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`btn-ghost btn-sm${sortingPaused ? "" : " btn-danger"}`}
      title={sortingPaused ? "Resume automatic sorting" : "Pause automatic sorting"}
    >
      {isPending
        ? sortingPaused ? "Resuming…" : "Pausing…"
        : sortingPaused ? "▶ Resume sorting" : "⏸ Pause sorting"}
    </button>
  );
}
