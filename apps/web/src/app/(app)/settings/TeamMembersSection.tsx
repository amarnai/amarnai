"use client";

import Link from "next/link";
import { useState, useTransition, useRef } from "react";
import {
  inviteMemberAction,
  removeMemberAction,
  cancelInvitationAction,
} from "@/actions/members";

type Member = {
  id: string;
  userId: string;
  role: string;
  user: { email: string; name: string | null };
};

type PendingInvitation = {
  id: string;
  invitedEmail: string;
  expiresAt: string;
};

type Props = {
  workspaceId: string;
  isAdmin: boolean;
  members: Member[];
  pendingInvitations: PendingInvitation[];
  collaboratorLimit: number;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`role-badge role-badge--${role === "OWNER" ? "admin" : "member"}`}>
      {role === "OWNER" ? "Admin" : "Member"}
    </span>
  );
}

export function TeamMembersSection({
  workspaceId,
  isAdmin,
  members,
  pendingInvitations: initialInvitations,
  collaboratorLimit,
}: Props) {
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const teamMemberCount = members.filter((m) => m.role !== "OWNER").length;
  const atLimit = teamMemberCount >= collaboratorLimit;

  function handleInvite() {
    const email = inviteInput.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setInviteError("Enter a valid email address");
      return;
    }
    setInviteError(null);
    setInviteSuccess(null);

    startTransition(async () => {
      const result = await inviteMemberAction(workspaceId, email);
      if (result.error) {
        setInviteError(result.error);
      } else {
        setInviteSuccess(`Invitation sent to ${email}`);
        setInviteInput("");
        // Optimistically add to pending list (server will revalidate for full refresh).
        setInvitations((prev) => [
          ...prev.filter((i) => i.invitedEmail !== email),
          {
            id: `pending-${Date.now()}`,
            invitedEmail: email,
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          },
        ]);
        inputRef.current?.focus();
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInvite();
    }
  }

  function handleRemove(memberUserId: string) {
    setRemovingId(memberUserId);
    setRemoveError(null);
    startTransition(async () => {
      const result = await removeMemberAction(workspaceId, memberUserId);
      if (result.error) {
        setRemoveError(result.error);
      }
      setRemovingId(null);
    });
  }

  function handleCancelInvitation(invitationId: string, email: string) {
    setCancellingId(invitationId);
    startTransition(async () => {
      const result = await cancelInvitationAction(workspaceId, invitationId);
      if (!result.error) {
        setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      }
      setCancellingId(null);
      void email;
    });
  }

  return (
    <section className="settings-section">
      <h2>Collaborators</h2>
      <p className="settings-hint">
        {isAdmin
          ? collaboratorLimit === 0
            ? <>Collaborators are available on Pro and Business subscriptions. <Link href="/upgrade">Upgrade to add.</Link></>
            : `You can invite up to ${collaboratorLimit} collaborators to this workspace.`
          : "People with access to this workspace."}
      </p>

      <ul className="members-list">
        {members.map((member) => (
          <li key={member.id} className="member-row">
            <div className="member-info">
              {member.user.name && (
                <span className="member-name">{member.user.name}</span>
              )}
              <span className="member-email">{member.user.email}</span>
            </div>
            <RoleBadge role={member.role} />
            {isAdmin && member.role !== "OWNER" && (
              <button
                type="button"
                className="member-remove"
                onClick={() => handleRemove(member.userId)}
                disabled={isPending && removingId === member.userId}
                aria-label={`Remove ${member.user.email}`}
              >
                {removingId === member.userId ? "Removing…" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {removeError && <p className="members-error">{removeError}</p>}

      {invitations.length > 0 && (
        <div className="settings-subsection">
          <h3>Pending invitations</h3>
          <ul className="invitations-list">
            {invitations.map((inv) => (
              <li key={inv.id} className="invitation-row">
                <span className="invitation-email">{inv.invitedEmail}</span>
                {isAdmin && (
                  <button
                    type="button"
                    className="invitation-cancel"
                    onClick={() => handleCancelInvitation(inv.id, inv.invitedEmail)}
                    disabled={isPending && cancellingId === inv.id}
                    aria-label={`Cancel invitation for ${inv.invitedEmail}`}
                  >
                    {cancellingId === inv.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && (
        <div className="settings-subsection">
          <h3>Invite a collaborator</h3>
          {atLimit ? (
            <p className="settings-hint">
              {collaboratorLimit === 0
                ? "Upgrade to a Pro or Business subscription to invite collaborators."
                : `Maximum of ${collaboratorLimit} collaborators reached.`}
            </p>
          ) : (
            <>
              <div className="members-invite-form">
                <input
                  ref={inputRef}
                  className="blacklist-input"
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteInput}
                  onChange={(e) => {
                    setInviteInput(e.target.value);
                    setInviteError(null);
                    setInviteSuccess(null);
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={isPending}
                  aria-label="Email address to invite"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleInvite}
                  disabled={isPending || inviteInput.trim() === ""}
                >
                  {isPending ? "Sending…" : "Send invite"}
                </button>
              </div>
              {inviteError && <p className="members-error">{inviteError}</p>}
              {inviteSuccess && <p className="members-success">{inviteSuccess}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
