import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { ApiClient } from "@amarnai/api-client";

// Triggers an on-demand AI triage for a thread that has not been sorted yet.
// The call queues the work server-side; the result arrives via the SSE `synced`
// refresh, so the button just flips to a disabled "Sorting…" state. Extension-
// only: the web app routes the whole backlog via a banner instead.
export function SortNowButton({
  api,
  workspaceId,
  threadId,
}: {
  api: ApiClient;
  workspaceId: string;
  threadId: string;
}) {
  const [sorting, setSorting] = useState(false);

  function onClick() {
    if (sorting) return;
    setSorting(true);
    api.aiTriage(workspaceId, threadId).catch(() => setSorting(false));
  }

  return (
    <button type="button" className="ax-btn ax-btn-secondary ax-sort-now" onClick={onClick} disabled={sorting}>
      {sorting ? <Trans>Sorting…</Trans> : <Trans>Sort now</Trans>}
    </button>
  );
}
