"use client";

import { useMemo, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { AssigneePicker, ThreadCommentsCard } from "@aziru/ui/emails";
import type { MemberItem, ThreadCommentItem } from "@aziru/ui/emails";
import {
  DEMO_AVATARS,
  DEMO_COMMENT_THREAD_ID,
  DEMO_MEMBER_AVATARS,
  getDemoComments,
  getDemoMembers,
  getDemoThreads,
} from "@aziru/ui/demo";

/**
 * The two teammates whose screens sit side by side. Both write into the same
 * comment list, so posting from either pane shows up on both — the visitor
 * plays both seats, which demonstrates shared state without simulating anyone.
 */
const PANE_IDS = ["u-akhenaten", "u-tutu"] as const;

/** Member hue (gold for Akhenaten, teal for Tutu), as a CSS-variable-setting
 *  class shared by that member's pane and their switcher avatar. */
function hueClass(userId: (typeof PANE_IDS)[number]): string {
  return userId === "u-akhenaten" ? "ld-collab-hue-gold" : "ld-collab-hue-teal";
}

/**
 * The collaboration demo: one email thread up top (with the real
 * AssigneePicker), and below it the same comment thread as two members see
 * it, each pane a real ThreadCommentsCard with that member as the current
 * user. State is plain locals — the card is pure presentation and this
 * section owns the "server".
 */
export function CollaborationSection() {
  const { i18n, _ } = useLingui();

  const members = useMemo(() => getDemoMembers(i18n), [i18n]);
  const thread = useMemo(
    () => getDemoThreads(i18n).find((t) => t.id === DEMO_COMMENT_THREAD_ID)!,
    [i18n],
  );
  const [comments, setComments] = useState<ThreadCommentItem[]>(() => getDemoComments(i18n));
  const [assignee, setAssignee] = useState<MemberItem | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<HTMLElement | null>(null);
  // Per-pane "N new" counts: posting from one pane raises the other's, and any
  // interaction with a pane clears its own — the read-marker behavior, minus
  // the server.
  const [unread, setUnread] = useState<Record<string, number>>({});
  // Bumped on every post; keys the sync badge so its pulse animation restarts,
  // making the cross-pane mirror visible at the moment it happens.
  const [pulseNonce, setPulseNonce] = useState(0);
  // Mobile shows one screen at a time (CSS hides the other below 720px; both
  // stay mounted so a half-typed draft survives the switch). Tutu is the
  // default seat: the seeded exchange ends on her reply, so continuing the
  // conversation is most natural from her side.
  const [activePane, setActivePane] = useState<(typeof PANE_IDS)[number]>("u-tutu");

  function postAs(userId: string) {
    return async (body: string, mentionUserIds: string[]): Promise<boolean> => {
      const member = members.find((m) => m.userId === userId)!;
      setComments((cs) => [
        ...cs,
        {
          id: `local-${userId}-${cs.length}`,
          body,
          mentionUserIds,
          author: { userId: member.userId, name: member.name, email: member.email },
          createdAt: new Date().toISOString(),
        },
      ]);
      setUnread((u) => {
        const next = { ...u };
        for (const paneId of PANE_IDS) {
          if (paneId !== userId) next[paneId] = (next[paneId] ?? 0) + 1;
        }
        return next;
      });
      setPulseNonce((n) => n + 1);
      return true;
    };
  }

  function clearUnread(userId: string) {
    setUnread((u) => (u[userId] ? { ...u, [userId]: 0 } : u));
  }

  const sender = thread.messages[0]!;

  // Interpolated into the lede (not typed literally) so locales that
  // transliterate the names can't drift from the panes below.
  const akhenatenName =
    members.find((m) => m.userId === "u-akhenaten")!.name ?? "";
  const tutuName = members.find((m) => m.userId === "u-tutu")!.name ?? "";

  // One seat button of the mobile switcher: the member's avatar ringed in
  // their hue, dimmed while inactive, carrying their unread count (which the
  // pane's own first touch clears, so the count survives just long enough to
  // be seen next to the "N new" chip it announces).
  function renderSwitchButton(userId: (typeof PANE_IDS)[number]) {
    const member = members.find((m) => m.userId === userId)!;
    const count = unread[userId] ?? 0;
    const isActive = activePane === userId;
    return (
      <button
        type="button"
        className={`ld-collab-switch-btn ${hueClass(userId)}${isActive ? " is-active" : ""}`}
        aria-pressed={isActive}
        aria-label={_(msg`Switch to ${member.name ?? member.email}`)}
        onClick={() => setActivePane(userId)}
      >
        <img src={DEMO_MEMBER_AVATARS[userId]} alt="" width={32} height={32} />
        {count > 0 && <span className="ld-collab-switch-count">{count}</span>}
      </button>
    );
  }

  function renderPane(userId: (typeof PANE_IDS)[number]) {
    const member = members.find((m) => m.userId === userId)!;
    // Each pane carries its member's hue, echoed from their portrait (his gold
    // regalia, her turquoise collar) via the themed folder-color tokens. The
    // glow swells while the pane has unread comments and settles on interaction.
    const hasUnread = (unread[userId] ?? 0) > 0;
    return (
      <div
        key={userId}
        className={`ld-collab-pane ${hueClass(userId)}${hasUnread ? " has-unread" : ""}${
          activePane === userId ? " is-active" : ""
        }`}
        onPointerDownCapture={() => clearUnread(userId)}
        onFocusCapture={() => clearUnread(userId)}
      >
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
            {/* The same labels the web app's Team section shows: the
                OWNER role renders as "Admin", everyone else "Member"
                (TeamMembersSection precedent). */}
            <span className="ld-collab-role">
              {userId === "u-akhenaten" ? <Trans>Admin</Trans> : <Trans>Member</Trans>}
            </span>
          </div>
        </div>
        <ThreadCommentsCard
          state={{ kind: "ready", comments }}
          unread={unread[userId] ?? 0}
          members={members}
          currentUserId={userId}
          posting={false}
          postError={null}
          onCreate={postAs(userId)}
          onDelete={(commentId) =>
            setComments((cs) => cs.filter((c) => c.id !== commentId))
          }
          onRetry={() => {}}
        />
      </div>
    );
  }

  return (
    <section className="ld-demo-section" id="collab">
      <div className="ld-wrap">
        <div className="ld-demo-head ld-reveal">
          <div className="ld-copy">
            <h2 className="ld-section-h">
              <Trans>Email is teamwork.</Trans>
            </h2>
            <p className="ld-section-lede">
              <Trans>
                No one emails alone. Assign each thread an owner, and talk it
                through in comments. Try it below: write as {akhenatenName} or
                as {tutuName}.
              </Trans>
            </p>
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          {/* No frame bar: the composers' own placeholders teach the @-mention,
              and the lede grants the "write as either teammate" permission. */}
          <div className="ld-collab-stage">
            {/* The thread the team is discussing, with the assignment control. */}
            <div className="ld-collab-email">
              <img
                className="ld-collab-sender-pfp"
                src={DEMO_AVATARS[thread.id]}
                alt=""
                width={44}
                height={44}
              />
              <div className="ld-collab-email-main">
                {/* The assign pill shares the header line (pushed right with
                    margin, not its own column), so a longer assignee name eats
                    header whitespace instead of reflowing the email text. */}
                <div className="ld-collab-email-top">
                  <span className="ld-collab-sender">{sender.fromName}</span>
                  <span className="ld-collab-sender-email">{sender.fromEmail}</span>
                  <button
                    type="button"
                    className={`em-preview-assign ld-collab-assign${assignee ? " is-assigned" : ""}`}
                    aria-label={
                      assignee
                        ? _(msg`Assigned to ${assignee.name ?? assignee.email}. Change assignee`)
                        : _(msg`Assign to a member`)
                    }
                    onClick={(e) =>
                      setAssignAnchor((a) => (a ? null : e.currentTarget))
                    }
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <circle cx="6" cy="4" r="2.1" stroke="currentColor" strokeWidth="1.3" />
                      <path
                        d="M1.9 10.4c0-2 1.8-3.3 4.1-3.3s4.1 1.3 4.1 3.3"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                    {assignee ? (assignee.name ?? assignee.email) : <Trans>Assign</Trans>}
                  </button>
                </div>
                <div className="ld-collab-subject">{thread.subject}</div>
                <p className="ld-collab-snippet">{thread.snippet}</p>
              </div>
            </div>

            {/* The same comment thread, as each of the two members sees it,
                with the sync mark between them saying why the lists match. */}
            {renderPane(PANE_IDS[0])}
            <div className="ld-collab-sync">
              {/* On mobile the badge grows an avatar on each side and becomes
                  the seat switcher; only one pane is shown at a time there, and
                  the hidden member's unread count lands on their avatar (the
                  hidden pane's glow can't be seen). Desktop hides the avatars
                  and keeps the badge purely declarative. */}
              {/* Tutu first: she is the default seat, so the active avatar
                  reads left-to-right before the seat you can switch to. (The
                  desktop panes keep Akhenaten on the left; only this mobile
                  switcher is ordered by default-first.) */}
              <div className="ld-collab-switch">
                {renderSwitchButton(PANE_IDS[1])}
                <span
                  key={pulseNonce}
                  className={`ld-collab-sync-badge${pulseNonce > 0 ? " pulse" : ""}`}
                  aria-hidden
                >
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
                {renderSwitchButton(PANE_IDS[0])}
              </div>
              <span className="ld-collab-sync-caption">
                <Trans>One conversation, shared by the whole team.</Trans>
              </span>
            </div>
            {renderPane(PANE_IDS[1])}
          </div>
        </div>
      </div>

      <AssigneePicker
        members={members}
        assignedUserId={assignee?.userId ?? null}
        anchor={assignAnchor}
        onCommit={(userId) => {
          setAssignee(userId ? members.find((m) => m.userId === userId) ?? null : null);
          setAssignAnchor(null);
        }}
        onClose={() => setAssignAnchor(null)}
      />
    </section>
  );
}
