"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { ThreadCommentsCard } from "@aziru/ui/emails";
import {
  DEMO_AVATARS,
  DEMO_COMMENT_THREAD_ID,
  DEMO_MEMBER_AVATARS,
  getDemoComments,
  getDemoMembers,
  getDemoThreads,
} from "@aziru/ui/demo";
import { TileFrame } from "./TileFrame";

/**
 * Store tile 5 — collaboration, the landing page's collab demo frozen: the
 * discussed email up top with an owner assigned, and the same comment thread
 * as two teammates see it, side by side. The assignee is Pentu because the
 * seeded exchange ends with Tutu handing the reply to @Pentu — the pill shows
 * where that conversation landed.
 */
export function Tile5() {
  const { i18n } = useLingui();
  const members = useMemo(() => getDemoMembers(i18n), [i18n]);
  const comments = useMemo(() => getDemoComments(i18n), [i18n]);
  const thread = useMemo(
    () => getDemoThreads(i18n).find((t) => t.id === DEMO_COMMENT_THREAD_ID)!,
    [i18n],
  );
  const sender = thread.messages[0]!;
  const assignee = members.find((m) => m.userId === "u-pentu")!;

  const pane = (userId: "u-akhenaten" | "u-tutu") => {
    const member = members.find((m) => m.userId === userId)!;
    const hue = userId === "u-akhenaten" ? "ld-collab-hue-gold" : "ld-collab-hue-teal";
    return (
      <div className={`ld-collab-pane ${hue}`}>
        <div className="ld-collab-persona">
          <img
            className="ld-collab-pfp"
            src={DEMO_MEMBER_AVATARS[userId]}
            alt=""
            width={40}
            height={40}
          />
          <div className="ld-collab-persona-text">
            <span className="ld-collab-name">{member.name ?? member.email}</span>
            <span className="ld-collab-role">
              {userId === "u-akhenaten" ? <Trans>Admin</Trans> : <Trans>Member</Trans>}
            </span>
          </div>
        </div>
        <ThreadCommentsCard
          state={{ kind: "ready", comments }}
          unread={0}
          members={members}
          currentUserId={userId}
          posting={false}
          postError={null}
          onCreate={async () => true}
          onDelete={() => {}}
          onRetry={() => {}}
        />
      </div>
    );
  };

  return (
    <TileFrame
      headline={
        <Trans>
          <span className="soft">Email is teamwork.</span> Assign and discuss.
        </Trans>
      }
    >
      <div className="ld-collab-stage st-collab">
        <div className="ld-collab-email">
          <img
            className="ld-collab-sender-pfp"
            src={DEMO_AVATARS[thread.id]}
            alt=""
            width={44}
            height={44}
          />
          <div className="ld-collab-email-main">
            <div className="ld-collab-email-top">
              <span className="ld-collab-sender">{sender.fromName}</span>
              <span className="ld-collab-sender-email">{sender.fromEmail}</span>
              <span className="em-preview-assign ld-collab-assign is-assigned">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <circle cx="6" cy="4" r="2.1" stroke="currentColor" strokeWidth="1.3" />
                  <path
                    d="M1.9 10.4c0-2 1.8-3.3 4.1-3.3s4.1 1.3 4.1 3.3"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                <Trans>Assigned to {assignee.name ?? assignee.email}</Trans>
              </span>
            </div>
            <div className="ld-collab-subject">{thread.subject}</div>
            <p className="ld-collab-snippet">{thread.snippet}</p>
          </div>
        </div>

        {pane("u-akhenaten")}
        <div className="ld-collab-sync">
          <span className="ld-collab-sync-badge" aria-hidden>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <path
                d="M4 5h8m0 0L9.5 2.5M12 5 9.5 7.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 11H4m0 0 2.5-2.5M4 11l2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="ld-collab-sync-caption">
            <Trans>One conversation, shared by the whole team.</Trans>
          </span>
        </div>
        {pane("u-tutu")}
      </div>
    </TileFrame>
  );
}
