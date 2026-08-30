"use client";

import { useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { folderInkVar } from "@aziru/core/emails";
import type { FolderItem } from "@aziru/ui/emails";
import { ReroutePopover, TriageBar, AssigneePicker } from "@aziru/ui/emails";
import type { EmailThreadDetail, MemberItem } from "./types.js";

// Where Amarnai put this thread, and every way the reader can disagree with it.
//
// There is no separate "approve" action and no rationale card: a folder the user
// leaves alone IS the approval, and the reasoning behind a sort turned out to be
// something almost nobody read. What is left is one chip that says the answer
// and opens the picker when the answer is wrong.
//
// No important star either, unlike the web preview. This panel sits a few
// inches from the mail client's own star for the same conversation, wearing the
// same glyph and meaning something else (Amarnai's important queue, which does
// not sync with the provider's flag in either direction). Two stars that can
// disagree about one thread is worse than one star in the web app.

export type ClassificationCardProps = {
  thread: EmailThreadDetail;
  /** Loaded lazily, on first picker open. Null until then. */
  folders: FolderItem[] | null;
  members: MemberItem[] | null;
  canAssign: boolean;
  onRequestFolders: () => void;
  onRequestMembers: () => void;
  onMove: (nodeId: string) => void;
  onToggleDone: () => void;
  onAssign: (userId: string | null) => void;
  onSortNow: () => void;
};

export function ClassificationCard({
  thread,
  folders,
  members,
  canAssign,
  onRequestFolders,
  onRequestMembers,
  onMove,
  onToggleDone,
  onAssign,
  onSortNow,
}: ClassificationCardProps) {
  const { i18n } = useLingui();
  const chipRef = useRef<HTMLButtonElement>(null);
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);

  // The last run's destination when it had one, otherwise the folder the thread
  // is still filed in. A needs-review re-sort records no destination, and
  // calling the thread unsorted because of that would contradict the label the
  // reader can see on the very same conversation.
  const folder = thread.latestClassification?.finalNode ?? thread.filedNode ?? null;
  const needsReview = thread.triageStatus === "NEEDS_REVIEW";
  const isSorting = thread.isClassifying;
  const isUnsorted =
    thread.triageStatus === "PENDING" ||
    thread.triageStatus === "UNROUTED" ||
    thread.triageStatus === "UNCLASSIFIED";

  function openReroute() {
    onRequestFolders();
    setRerouteAnchor(chipRef.current);
  }

  return (
    <div className="apn-classification">
      <div className="apn-chip-row">
        {isSorting ? (
          <span className="apn-chip apn-chip-sorting" aria-live="polite">
            <span className="apn-skeleton-pulse" aria-hidden />
            <Trans>Sorting…</Trans>
          </span>
        ) : folder ? (
          <button
            type="button"
            ref={chipRef}
            className={`apn-chip apn-chip-folder${needsReview ? " is-review" : ""}`}
            style={{ color: folderInkVar({ id: folder.id }) }}
            onClick={openReroute}
            aria-haspopup="dialog"
            aria-expanded={rerouteAnchor !== null}
            aria-label={i18n._(msg`Filed in ${folder.name}. Move to another folder`)}
          >
            <span className="apn-chip-dot" aria-hidden />
            {folder.name}
          </button>
        ) : (
          <button
            type="button"
            ref={chipRef}
            className="apn-chip apn-chip-unsorted"
            onClick={openReroute}
            aria-haspopup="dialog"
            aria-expanded={rerouteAnchor !== null}
          >
            <Trans>Not sorted yet</Trans>
          </button>
        )}
      </div>

      {needsReview && !isSorting && (
        <p className="apn-review-note">
          <Trans>Amarnai wasn't sure about this one. Move it if it's in the wrong place.</Trans>
        </p>
      )}

      {isUnsorted && !isSorting && (
        <button type="button" className="apn-btn apn-btn-secondary" onClick={onSortNow}>
          <Trans>Sort now</Trans>
        </button>
      )}

      <TriageBar
        isDone={!!thread.doneMark}
        doneMark={thread.doneMark}
        onMark={onToggleDone}
        onUnmark={onToggleDone}
        assignment={thread.assignment}
        canAssign={canAssign}
        onOpenAssign={(anchor) => {
          onRequestMembers();
          setAssignAnchor(anchor);
        }}
      />

      {rerouteAnchor && folders && (
        <ReroutePopover
          folders={folders}
          anchor={rerouteAnchor}
          onCommit={(folderId) => {
            setRerouteAnchor(null);
            onMove(folderId);
          }}
          onClose={() => setRerouteAnchor(null)}
        />
      )}

      {assignAnchor && members && (
        <AssigneePicker
          members={members}
          assignedUserId={thread.assignment?.userId ?? null}
          anchor={assignAnchor}
          onCommit={(userId) => {
            setAssignAnchor(null);
            onAssign(userId);
          }}
          onClose={() => setAssignAnchor(null)}
        />
      )}
    </div>
  );
}
