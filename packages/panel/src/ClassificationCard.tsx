"use client";

import { useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { folderInkVar } from "@amarnai/core/emails";
import type { FolderItem } from "@amarnai/ui/emails";
import { ReroutePopover, TriageBar, AssigneePicker } from "@amarnai/ui/emails";
import type { EmailThreadDetail, MemberItem } from "./types.js";

// Where Amarnai put this thread, and every way the reader can disagree with it.
//
// There is no separate "approve" action and no rationale card: a folder the user
// leaves alone IS the approval, and the reasoning behind a sort turned out to be
// something almost nobody read. What is left is one chip that says the answer
// and opens the picker when the answer is wrong.

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
  onToggleImportant: () => void;
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
  onToggleImportant,
  onAssign,
  onSortNow,
}: ClassificationCardProps) {
  const { i18n } = useLingui();
  const chipRef = useRef<HTMLButtonElement>(null);
  const [rerouteAnchor, setRerouteAnchor] = useState<HTMLElement | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);

  const folder = thread.latestClassification?.finalNode ?? null;
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
            <Trans>Not filed</Trans>
          </button>
        )}

        <button
          type="button"
          className={`apn-icon-btn apn-star${thread.isImportant ? " is-important" : ""}`}
          aria-pressed={thread.isImportant}
          aria-label={
            thread.isImportant
              ? i18n._(msg`Remove from important`)
              : i18n._(msg`Mark as important`)
          }
          onClick={onToggleImportant}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M7 1.75l1.545 3.13 3.455.502-2.5 2.437.59 3.44L7 9.63l-3.09 1.625.59-3.44-2.5-2.437 3.455-.502z"
              fill={thread.isImportant ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={thread.isImportant ? 0 : 1.3}
              strokeLinejoin="round"
            />
          </svg>
        </button>
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
