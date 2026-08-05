"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans } from "@lingui/react/macro";
import type { MemberItem } from "./types.js";
import { findMentionSegments } from "./mentionSegments.js";

export interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  /** null = member list still loading (injected-panel tri-state): the picker
   *  simply does not open and nothing highlights. An empty array renders the
   *  no-match row. */
  members: MemberItem[] | null;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}

/** The active "@query" token immediately before the caret, if any. */
function mentionContext(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query };
}

// Plain textarea with an @-mention autocomplete and live tag highlighting.
//
// The popover reuses the AssigneePicker's anatomy and classes (portal to
// <body>, fixed positioning, listbox rows, mousedown-with-preventDefault so the
// textarea keeps focus) but the keyboard model is inverted: focus never leaves
// the textarea, which intercepts ArrowUp/Down/Enter/Tab/Escape only while the
// popover is open. Filtering happens client-side over the already-loaded
// member list (workspaces are capped at ~26 members).
//
// Highlighting: a textarea cannot style substrings, so an aria-hidden backdrop
// renders the same text with valid tags (per findMentionSegments — however
// they were typed, picker or by hand) in the accent color, and the textarea on
// top paints its text transparent, keeping only the caret and selection. The
// two layers share font, padding, line-height and wrapping via
// .em-comment-textarea / .em-comment-highlight, and scroll in lockstep.
export function MentionTextarea({
  value,
  onChange,
  members,
  disabled = false,
  placeholder,
  maxLength,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<{ start: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // Escape dismisses the popover for the current token: extending it stays
  // quiet (Escape meant "not here"), and only a new @ token re-arms it.
  const dismissedStartRef = useRef<number | null>(null);
  // Caret position to restore after a programmatic insert re-renders the value.
  const pendingCaretRef = useRef<number | null>(null);

  const syncContext = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const next = mentionContext(el.value, el.selectionStart ?? el.value.length);
    if (next && dismissedStartRef.current === next.start) {
      setContext(null);
      return;
    }
    if (next?.start !== context?.start) dismissedStartRef.current = null;
    setContext(next);
  }, [context?.start]);

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    }
    pendingCaretRef.current = null;
  }, [value]);

  const query = context?.query.toLowerCase() ?? "";
  const filtered =
    context && members
      ? members.filter(
          (m) =>
            (m.name ?? "").toLowerCase().includes(query) ||
            m.email.toLowerCase().includes(query),
        )
      : [];
  const open = context !== null && members !== null;

  useEffect(() => {
    setActiveIdx(0);
  }, [context?.start, query]);

  // Position the popover once it has rendered (its height is content-driven).
  // Flips above the textarea when there is no room below — the composer sits at
  // the bottom of a scrolling column, so downward placement often has no space.
  useEffect(() => {
    if (!open) return;
    const el = textareaRef.current;
    const panel = panelRef.current;
    if (!el || !panel) return;
    const rect = el.getBoundingClientRect();
    const fitsBelow = rect.bottom + 6 + panel.offsetHeight <= window.innerHeight - 8;
    panel.style.top = fitsBelow
      ? `${rect.bottom + 6}px`
      : `${Math.max(8, rect.top - panel.offsetHeight - 6)}px`;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8));
    panel.style.left = `${left}px`;
  }, [open, filtered.length]);

  const select = useCallback(
    (member: MemberItem) => {
      const el = textareaRef.current;
      if (!el || !context) return;
      const caret = el.selectionStart ?? value.length;
      const label = member.name ?? member.email;
      const inserted = `@${label} `;
      const nextValue = value.slice(0, context.start) + inserted + value.slice(caret);
      pendingCaretRef.current = context.start + inserted.length;
      dismissedStartRef.current = null;
      setContext(null);
      onChange(nextValue);
    },
    [context, value, onChange],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const chosen = filtered[activeIdx];
      if (chosen) {
        e.preventDefault();
        select(chosen);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (context) dismissedStartRef.current = context.start;
      setContext(null);
    }
  }

  // The backdrop's copy of the text, with valid tags wrapped for color. A
  // trailing space stands in for a trailing newline, which would otherwise
  // collapse and let the layers drift by one line.
  function renderHighlight(): React.ReactNode {
    const segments = findMentionSegments(value, members);
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    for (const seg of segments) {
      if (seg.start > cursor) nodes.push(value.slice(cursor, seg.start));
      nodes.push(
        <span key={seg.start} className="em-comment-highlight-mention">
          {value.slice(seg.start, seg.end)}
        </span>,
      );
      cursor = seg.end;
    }
    if (cursor < value.length) nodes.push(value.slice(cursor));
    if (value.endsWith("\n")) nodes.push(" ");
    return nodes;
  }

  return (
    <>
      <div className="em-comment-input-wrap">
        <div ref={highlightRef} className="em-comment-highlight" aria-hidden>
          {renderHighlight()}
        </div>
        <textarea
          ref={textareaRef}
          className="em-comment-textarea"
          value={value}
          disabled={disabled}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(maxLength !== undefined ? { maxLength } : {})}
          onChange={(e) => {
            onChange(e.target.value);
            syncContext();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncContext}
          onClick={syncContext}
          onBlur={() => setContext(null)}
          onScroll={(e) => {
            if (highlightRef.current) {
              highlightRef.current.scrollTop = e.currentTarget.scrollTop;
            }
          }}
        />
      </div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          // Portaled to <body> for the same reason as AssigneePicker: the panel
          // is position:fixed and .em-shell's containment would otherwise
          // become its containing block.
          <div ref={panelRef} className="em-assignee-panel" role="presentation">
            <ul className="em-assignee-list" role="listbox">
              {filtered.length === 0 && (
                <li className="em-assignee-empty">
                  <Trans>No matching members</Trans>
                </li>
              )}
              {filtered.map((m, i) => (
                <li
                  key={m.userId}
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`em-assignee-item${i === activeIdx ? " active" : ""}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(m);
                  }}
                >
                  <span className="em-assignee-item-label">{m.name ?? m.email}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
