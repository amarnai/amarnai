"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  threadId: string;
};

export function RetryButton({ workspaceId, threadId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleRetry() {
    setStatus("loading");
    setErrorMsg(null);
    try {
      await api.aiClassify(workspaceId, threadId);
      // Refresh server data — if classification is now confident the card
      // will disappear; if still uncertain a fresh review item replaces it.
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Retry failed");
      setStatus("error");
    } finally {
      if (status !== "error") setStatus("idle");
    }
  }

  return (
    <div className="retry-button-wrap">
      <button
        className="btn-retry"
        onClick={handleRetry}
        disabled={status === "loading"}
        type="button"
      >
        {status === "loading" ? "Retrying…" : "Retry sorting"}
      </button>
      {errorMsg && <span className="retry-error">{errorMsg}</span>}
    </div>
  );
}
