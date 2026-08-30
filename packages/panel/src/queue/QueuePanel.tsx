"use client";

import { Trans } from "@lingui/react/macro";
import type { ApiClient } from "@aziru/api-client";
import type { PanelHost } from "../host.js";
import type { PanelQueueSection, PanelQueueThread } from "../types.js";
import { ErrorState, LoadingState } from "../states/PanelStates.js";
import { QueueRow } from "./QueueRow.js";
import { QueueSection } from "./QueueSection.js";
import { SortingStrip } from "./SortingStrip.js";
import { useQueueState } from "./useQueueState.js";
import type { QueueSectionKey } from "./sectionCollapse.js";

// What the panel shows when the mail client has no conversation open.
//
// An action queue, not an inbox: only threads that are waiting on this user, in
// the order they are waiting. It never tries to be the thread list a few inches
// to its left — no folders, no search, no paging — because that list is better
// at being itself than a 300px column could be. Each row's click opens the
// thread on the panel's own conversation screen, and hands it to the mail client
// as well where that client can be navigated — which is the whole point of
// living inside it.
//
// Three sections, each a different reason a thread is waiting:
//
//   Assigned to you   yours to handle, and not yet done. Present even in a
//                     workspace of one: assigning a thread to yourself is how
//                     you park it for later.
//   Needs review      Aziru was not confident enough to file it.
//   Drafts            a reply is written and waiting for approval. Invisible
//                     anywhere else until you reopen the thread.
//
// Only the assigned section is open by default. It is the one the user put
// there themselves, and it is bounded by how much they chose to take on; the
// other two are as long as the inbox makes them, and opening the panel onto
// hundreds of rows would bury the section that is actually theirs. Both still
// carry their count in the header, so a closed section is never mistaken for
// an empty one, and the choice is remembered once it is made.

export type QueuePanelProps = {
  api: ApiClient;
  host: PanelHost;
  workspaceId: string;
  accountEmail: string;
  visible: boolean;
  onInjectionDisabled: () => void;
  /**
   * A row was clicked. The panel switches to that thread's screen itself rather
   * than waiting to be told the mail client moved, because it may not: an
   * Outlook pane cannot navigate, and Gmail reports no change when asked for the
   * conversation it already has open.
   */
  onOpenThread: (providerThreadId: string) => void;
};

export function QueuePanel({
  api,
  host,
  workspaceId,
  accountEmail,
  visible,
  onInjectionDisabled,
  onOpenThread,
}: QueuePanelProps) {
  const { queue, syncStatus, loading, error, refresh, toggleDone } = useQueueState({
    api,
    host,
    workspaceId,
    visible,
    onInjectionDisabled,
  });

  if (loading) return <LoadingState />;
  if (error || !queue) return <ErrorState onRetry={refresh} />;

  const total =
    queue.assignedToMe.count + queue.needsReview.count + queue.proposedDrafts.count;

  const renderSection = (
    key: QueueSectionKey,
    title: React.ReactNode,
    section: PanelQueueSection,
    defaultCollapsed: boolean,
  ) => (
    <QueueSection
      section={key}
      title={title}
      count={section.count}
      defaultCollapsed={defaultCollapsed}
    >
      {section.threads.map((thread: PanelQueueThread) => (
        <QueueRow
          key={thread.id}
          thread={thread}
          accountEmail={accountEmail}
          host={host}
          onOpen={() => onOpenThread(thread.providerThreadId)}
          onToggleDone={() => toggleDone(thread)}
        />
      ))}
    </QueueSection>
  );

  return (
    <>
      <SortingStrip
        syncStatus={syncStatus}
        pendingCount={queue.pendingCount}
        pendingWaitingCount={queue.pendingWaitingCount}
      />

      {renderSection("assigned", <Trans>Assigned to you</Trans>, queue.assignedToMe, false)}
      {renderSection("needsReview", <Trans>Needs review</Trans>, queue.needsReview, true)}
      {renderSection("drafts", <Trans>Drafts awaiting approval</Trans>, queue.proposedDrafts, true)}

      {total === 0 && (
        <div className="apn-state">
          <p className="apn-state-text">
            <Trans>Nothing is waiting on you right now.</Trans>
          </p>
          <p className="apn-queue-hint">
            <Trans>
              Assign a thread to yourself from any conversation and it will show up here.
            </Trans>
          </p>
        </div>
      )}
    </>
  );
}
