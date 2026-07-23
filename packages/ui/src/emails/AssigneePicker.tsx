"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MemberItem } from "./types.js";

export interface AssigneePickerProps {
  members: MemberItem[];
  /** Currently-assigned user id, if any (drives the check + Unassign row). */
  assignedUserId: string | null;
  anchor: HTMLElement | null;
  /** userId to assign, or null to unassign. */
  onCommit: (userId: string | null) => void;
  onClose: () => void;
  /** When set, an "Add members" row is appended so solo users can jump to the
   * invite flow instead of hitting a dead end. */
  onAddMembers?: () => void;
  /** Badges the Add-members row with "Upgrade" when the plan has no
   * collaborator seats, so the row honestly signals it leads to a paywall. */
  addMembersRequiresUpgrade?: boolean;
}

// Anchored member picker adapted from ReroutePopover. No search input:
// workspaces are capped at ~26 members by plan limits, so the list is always
// short. An "Unassign" row is shown at the top only when the thread is currently
// assigned, and an "Add members" row at the bottom when `onAddMembers` is
// provided. Keyboard-navigable (Up/Down/Enter/Escape).
export function AssigneePicker({ members, assignedUserId, anchor, onCommit, onClose, onAddMembers, addMembersRequiresUpgrade }: AssigneePickerProps) {
  const { i18n } = useLingui();
  const panelRef = useRef<HTMLDivElement>(null);

  // The selectable rows, in render order: an optional Unassign row (value null),
  // each member (value userId), then an optional Add-members row.
  const rows: Array<{ key: string; value: string | null; label: string; isAddMembers?: boolean }> = [];
  if (assignedUserId) {
    rows.push({ key: "__unassign__", value: null, label: i18n._(msg`Unassign`) });
  }
  for (const m of members) {
    rows.push({ key: m.userId, value: m.userId, label: m.name ?? m.email });
  }
  if (onAddMembers) {
    rows.push({ key: "__add_members__", value: null, label: i18n._(msg`Add members`), isAddMembers: true });
  }

  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (anchor) setActiveIdx(0);
  }, [anchor]);

  useEffect(() => {
    if (!anchor || !panelRef.current) return;
    const rect = anchor.getBoundingClientRect();
    const panel = panelRef.current;
    panel.style.top = `${rect.bottom + 6}px`;
    // Clamp to the viewport: anchors can sit at the right edge of a row (and
    // the extension panel is only ~360px wide), where an unclamped rect.left
    // would push the panel off-screen.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8));
    panel.style.left = `${left}px`;
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    function handle(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchor &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [anchor, onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = rows[activeIdx];
      if (!chosen) return;
      if (chosen.isAddMembers) onAddMembers?.();
      else onCommit(chosen.value);
    }
  }

  if (!anchor || typeof document === "undefined") return null;

  // Portaled to <body>: the panel is position:fixed and placed with viewport
  // coordinates, and .em-shell is a size container whose layout containment
  // would otherwise become the panel's containing block.
  return createPortal(
    <div
      ref={panelRef}
      className="em-assignee-panel"
      role="dialog"
      aria-label={i18n._(msg`Assign thread`)}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <ul className="em-assignee-list" role="listbox">
        {rows.length === 0 && (
          <li className="em-assignee-empty"><Trans>No members</Trans></li>
        )}
        {rows.map((row, i) => {
          const isUnassign = row.value === null && !row.isAddMembers;
          const isCurrent = row.value !== null && row.value === assignedUserId;
          return (
            <li
              key={row.key}
              role="option"
              aria-selected={i === activeIdx}
              className={`em-assignee-item${i === activeIdx ? " active" : ""}${isUnassign ? " is-unassign" : ""}${row.isAddMembers ? " is-add-members" : ""}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (row.isAddMembers) onAddMembers?.();
                else onCommit(row.value);
              }}
            >
              {row.isAddMembers && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
              <span className="em-assignee-item-label">{row.label}</span>
              {row.isAddMembers && addMembersRequiresUpgrade && (
                <span className="em-assignee-upgrade-badge"><Trans>Upgrade</Trans></span>
              )}
              {isCurrent && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M1.5 5l2.2 2.5L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}
