"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { AssigneePicker, ThreadCommentsCard, folderColorVars } from "@aziru/ui/emails";
import type { MemberItem, ThreadCommentItem } from "@aziru/ui/emails";
import {
  DEMO_AVATARS,
  DEMO_COMMENT_THREAD_ID,
  DEMO_MEMBER_AVATARS,
  getDemoComments,
  getDemoFolders,
  getDemoMembers,
  getDemoThreads,
} from "@aziru/ui/demo";

/**
 * The two teammates whose screens sit side by side. Both write into the same
 * comment list, so posting from either pane shows up on both — the visitor
 * plays both seats, which demonstrates shared state without simulating anyone.
 */
const PANE_IDS = ["u-akhenaten", "u-tutu"] as const;

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
  const folder = useMemo(
    () => getDemoFolders(i18n).find((f) => f.id === thread.folderId) ?? null,
    [i18n, thread],
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

  function renderPane(userId: (typeof PANE_IDS)[number]) {
    const member = members.find((m) => m.userId === userId)!;
    return (
      <div
        key={userId}
        className="ld-collab-pane"
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
              <Trans>Triage together.</Trans>
            </h2>
            <p className="ld-section-lede">
              <Trans>
                Assign any thread to a teammate so everyone knows who has what,
                and settle it in comments on the thread itself — @mention
                someone to pull them in. Conversations and assignments live in
                Aziru — the app and the side panel — layered over your shared
                inbox. And as always, Aziru never sends mail.
              </Trans>
            </p>
          </div>
        </div>

        <div className="ld-app-frame ld-reveal">
          <div className="ld-frame-bar">
            <span aria-hidden />
            <span className="ld-play-note">
              <Trans>Write as either teammate — type @ to mention someone.</Trans>
            </span>
            <span aria-hidden />
          </div>

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
                <div className="ld-collab-email-top">
                  <span className="ld-collab-sender">{sender.fromName}</span>
                  <span className="ld-collab-sender-email">{sender.fromEmail}</span>
                </div>
                <div className="ld-collab-subject">{thread.subject}</div>
                <p className="ld-collab-snippet">{thread.snippet}</p>
              </div>
              <div className="ld-collab-email-side">
                {folder && (
                  <span
                    className="em-route-chip"
                    style={folderColorVars(folder) as CSSProperties}
                  >
                    {folder.name}
                  </span>
                )}
                <button
                  type="button"
                  className={`em-preview-assign${assignee ? " is-assigned" : ""}`}
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
            </div>

            {/* The same comment thread, as each of the two members sees it,
                with the sync mark between them saying why the lists match. */}
            {renderPane(PANE_IDS[0])}
            <div className="ld-collab-sync">
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
