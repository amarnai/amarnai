"use client";

import { useTransition } from "react";
import { startSortingAction } from "@/actions/gmail";

type Props = {
  workspaceId: string;
};

export function StartSortingControl({ workspaceId }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      await startSortingAction(workspaceId);
    });
  }

  return (
    <button
      onClick={handleStart}
      disabled={isPending}
      className="btn-primary btn-sm"
    >
      {isPending ? "Starting…" : "Start sorting"}
    </button>
  );
}
