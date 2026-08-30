import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { mapFolders, mapThreads, type FolderItem, type ThreadItem } from "@aziru/core";
import type { OutlookAccountType } from "@aziru/core/emails";
import type { ApiClient, FilterCounts, SyncStatus, MailProvider } from "@aziru/api-client";
import { EmailsPanel } from "./EmailsPanel";
import { ConnectMailCta } from "./ConnectMailCta";
import { revealMailbox } from "../gmail/revealMailbox";
import { useSession } from "../auth/session";

type Seed = {
  folders: FolderItem[];
  threads: ThreadItem[];
  nextCursor: string | null;
  counts: FilterCounts;
  filteredTotal: number;
  syncStatus: SyncStatus | null;
  gmailAddress: string | null;
  workspaceEmail: string | null;
  // ACTIVE, DISCONNECTED, or null when no connection record exists yet. A record
  // can exist but be DISCONNECTED (revoked or token expired) — only ACTIVE is
  // actually syncing. Mirrors the web emails page gate.
  gmailStatus: "ACTIVE" | "DISCONNECTED" | null;
  // The connected mailbox's provider, so the reconnect CTA runs the right OAuth
  // flow (Google vs Microsoft). Null when no connection record exists yet.
  provider: MailProvider | null;
  // Outlook only: personal vs work/school, which decides the Outlook web host
  // the mailbox opens on. Null for Gmail and for connections predating it.
  outlookAccountType: OutlookAccountType | null;
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
  const { consumeJustConnected } = useSession();
  const [seed, setSeed] = useState<Seed | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped after a successful reconnect to re-run the loader and re-check status.
  const [reloadKey, setReloadKey] = useState(0);

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
          gmailStatus: connection?.status ?? null,
          provider: connection?.provider ?? null,
          outlookAccountType: connection?.outlookAccountType ?? null,
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, reloadKey]);

  // The user just signed in or connected an inbox: take them to it.
  //
  // Two conditions, and both have to be checked here. The seed is the only place
  // the provider and mailbox address are known for certain, and where an ACTIVE
  // connection (rather than a merely completed OAuth grant) is confirmed. The
  // session is the only place that knows a gesture happened at all: a seed load
  // after sign-in and a seed load after reopening the panel are identical from
  // the data alone, and moving someone's tab because they opened a side panel
  // would be indefensible.
  useEffect(() => {
    if (seed?.gmailStatus !== "ACTIVE") return;
    if (!consumeJustConnected()) return;
    void revealMailbox(seed.provider ?? "GMAIL", seed.gmailAddress, seed.outlookAccountType);
  }, [seed, consumeJustConnected]);

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

  // Anything but an ACTIVE connection means this inbox is not syncing, so show
  // the connect gate instead of a stale thread list. Mirrors the web gate: with
  // no connection record yet (provider null) it offers both Gmail and Outlook;
  // with a DISCONNECTED record it reconnects that same provider.
  if (seed.gmailStatus !== "ACTIVE") {
    return (
      <ConnectMailCta
        workspaceId={workspaceId}
        provider={seed.provider}
        onConnected={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <EmailsPanel
      // Remount cleanly when the workspace changes so the view-model re-seeds.
      key={workspaceId}
      api={api}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      provider={seed.provider ?? "GMAIL"}
      initialThreads={seed.threads}
      initialNextCursor={seed.nextCursor}
      initialCounts={seed.counts}
      initialFilteredTotal={seed.filteredTotal}
      initialFolders={seed.folders}
      initialSyncStatus={seed.syncStatus}
      workspaceEmail={seed.workspaceEmail}
      outlookAccountType={seed.outlookAccountType}
      gmailAddress={seed.gmailAddress}
      // A plan built in-panel changes what every part of the seed means, so
      // re-run the loader rather than patching pieces of it (same as reconnect).
      onPlanApplied={() => setReloadKey((k) => k + 1)}
    />
  );
}
