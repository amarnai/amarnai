import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { mapFolders, mapThreads, type FolderItem, type ThreadItem } from "@amarnai/core";
import type { ApiClient, FilterCounts, SyncStatus } from "@amarnai/api-client";
import { EmailsPanel } from "./EmailsPanel";

type Seed = {
  folders: FolderItem[];
  threads: ThreadItem[];
  nextCursor: string | null;
  counts: FilterCounts;
  filteredTotal: number;
  syncStatus: SyncStatus | null;
  gmailAddress: string | null;
  workspaceEmail: string | null;
};

// Loads the triage seed (taxonomy + threads + gmail connection + sync status)
// and mounts EmailsPanel only once it resolves. useEmailTriage seeds its state
// once via useState(initial…), so the panel must not mount until the real data
// exists — mirrors mobile's TriageProvider (with plain effects instead of
// react-query to keep the dependency tree small).
export function TriageGate({
  api,
  workspaceId,
  currentUserId,
}: {
  api: ApiClient;
  workspaceId: string;
  currentUserId: string;
}) {
  const [seed, setSeed] = useState<Seed | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSeed(null);
    setFailed(false);

    (async () => {
      try {
        const [nodes, edges, threadsResult, connection, syncStatus] = await Promise.all([
          api.taxonomyNodes(workspaceId),
          api.taxonomyEdges(workspaceId),
          api.emailThreads(workspaceId),
          api.gmailConnection(workspaceId).catch(() => null),
          api.syncStatus(workspaceId).catch(() => null),
        ]);
        if (cancelled) return;
        setSeed({
          folders: mapFolders(nodes, edges),
          threads: mapThreads(threadsResult.threads),
          nextCursor: threadsResult.nextCursor,
          counts: threadsResult.counts,
          filteredTotal: threadsResult.filteredTotal,
          syncStatus,
          gmailAddress: connection?.gmailAddress ?? null,
          workspaceEmail: connection?.gmailAddress ?? null,
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  if (failed) {
    return (
      <div className="ax-center ax-muted">
        <Trans>Couldn't load your inbox. Check your connection and reopen the panel.</Trans>
      </div>
    );
  }

  if (!seed) {
    return (
      <div className="ax-center">
        <span className="ax-spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <EmailsPanel
      // Remount cleanly when the workspace changes so the view-model re-seeds.
      key={workspaceId}
      api={api}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      initialThreads={seed.threads}
      initialNextCursor={seed.nextCursor}
      initialCounts={seed.counts}
      initialFilteredTotal={seed.filteredTotal}
      initialFolders={seed.folders}
      initialSyncStatus={seed.syncStatus}
      workspaceEmail={seed.workspaceEmail}
      gmailAddress={seed.gmailAddress}
    />
  );
}
