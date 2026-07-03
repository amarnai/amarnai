"use client";

import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { DoneMark, ThreadAssignment } from "./types.js";
import { PreviewDoneBar } from "./PreviewDoneBar.js";

interface Props {
  // Done toggle (reuses PreviewDoneBar).
  isDone: boolean;
  doneMark: DoneMark | null;
  onMark: () => void;
  onUnmark: () => void;
  showDoneBy?: boolean;

  // Assignment. All optional so consumers that don't support assignment (e.g.
  // the extension) can render a done-only bar unchanged.
  assignment?: ThreadAssignment | null;
  /** Show the assign affordance when unassigned (workspace has ≥2 members). */
  canAssign?: boolean;
  /** Open the member picker anchored to the passed element. */
  onOpenAssign?: (anchor: HTMLElement) => void;
}

// The unified per-thread triage bar shown in the preview: the "mark as done"
// toggle and the assignee control side by side. Ownership (assignee) and
// completion (done) are distinct, so both are shown; they are not merged.
export function TriageBar({
  isDone,
  doneMark,
  onMark,
  onUnmark,
  showDoneBy,
  assignment,
  canAssign,
  onOpenAssign,
}: Props) {
  const { i18n } = useLingui();

  // The assignee chip is only interactive when the parent wired an open
  // handler. When assigned, the chip is always shown (even without canAssign) so
  // the current owner is visible; when unassigned, it appears only if canAssign.
  const assigneeName = assignment ? (assignment.userName ?? assignment.userEmail) : "";
  const showAssignee = !!onOpenAssign && (!!assignment || !!canAssign);

  return (
    <div className="em-triage-bar">
      <PreviewDoneBar
        isDone={isDone}
        doneMark={doneMark}
        onMark={onMark}
        onUnmark={onUnmark}
        {...(showDoneBy !== undefined ? { showDoneBy } : {})}
      />

      {showAssignee && (
        <button
          type="button"
          className={`em-assign-btn${assignment ? " is-assigned" : ""}`}
          onClick={(e) => onOpenAssign?.(e.currentTarget)}
          aria-label={assignment
            ? i18n._(msg`Assigned to ${assigneeName}. Change assignee`)
            : i18n._(msg`Assign to a member`)}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="3.6" r="2.1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 10.2c0-2.1 1.8-3.4 4-3.4s4 1.3 4 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {assignment
            ? i18n._(msg`Assigned · ${assigneeName}`)
            : i18n._(msg`Assign`)}
        </button>
      )}
    </div>
  );
}
