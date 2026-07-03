"use client";

import { useEffect, useRef, useState } from "react";
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
}

// Anchored member picker adapted from ReroutePopover. No search input:
// workspaces are capped at ~26 members by plan limits, so the list is always
// short. An "Unassign" row is shown at the top only when the thread is currently
// assigned. Keyboard-navigable (Up/Down/Enter/Escape).
export function AssigneePicker({ members, assignedUserId, anchor, onCommit, onClose }: AssigneePickerProps) {
  const { i18n } = useLingui();
  const panelRef = useRef<HTMLDivElement>(null);

  // The selectable rows, in render order: an optional Unassign row (value null)
  // followed by each member (value userId).
  const rows: Array<{ key: string; value: string | null; label: string }> = [];
  if (assignedUserId) {
    rows.push({ key: "__unassign__", value: null, label: i18n._(msg`Unassign`) });
  }
  for (const m of members) {
    rows.push({ key: m.userId, value: m.userId, label: m.name ?? m.email });
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
    panel.style.left = `${rect.left}px`;
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
      if (chosen) onCommit(chosen.value);
    }
  }

  if (!anchor) return null;

  return (
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
          const isUnassign = row.value === null;
          const isCurrent = row.value !== null && row.value === assignedUserId;
          return (
            <li
              key={row.key}
              role="option"
              aria-selected={i === activeIdx}
              className={`em-assignee-item${i === activeIdx ? " active" : ""}${isUnassign ? " is-unassign" : ""}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); onCommit(row.value); }}
            >
              <span className="em-assignee-item-label">{row.label}</span>
              {isCurrent && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M1.5 5l2.2 2.5L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
