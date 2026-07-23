"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { FolderItem } from "../folder-tree/types.js";

export interface ReroutePopoverProps {
  folders: FolderItem[];
  anchor: HTMLElement | null;
  onCommit: (folderId: string) => void;
  onClose: () => void;
  // Pinned entries above the folder rows (the extension's scope switcher pins
  // "All mail" and "Assigned to me" here). Each participates in filtering and
  // keyboard navigation like a folder row, but commits through its own handler.
  topItems?: Array<{ id: string; label: string; onSelect: () => void; count?: number }> | undefined;
  // Localized overrides for the second use of this picker (scope switching);
  // defaults keep the original reroute copy.
  searchPlaceholder?: string | undefined;
  dialogLabel?: string | undefined;
  // Per-folder thread totals, keyed by folder id, shown right-aligned on each
  // row (scope-switcher use). Omit for the reroute use, which shows no counts.
  counts?: Map<string, number> | undefined;
  // When true, the panel widens to match the anchor element (a full-width bar),
  // instead of the default fixed 280px reroute width.
  matchAnchorWidth?: boolean | undefined;
}

type PickerEntry =
  | { kind: "top"; id: string; label: string; onSelect: () => void; count?: number }
  | { kind: "folder"; folder: FolderItem };

export function ReroutePopover({
  folders,
  anchor,
  onCommit,
  onClose,
  topItems,
  searchPlaceholder,
  dialogLabel,
  counts,
  matchAnchorWidth,
}: ReroutePopoverProps) {
  const { i18n } = useLingui();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const q = query.toLowerCase();
  const filtered = folders.filter((f) => !f.ignored && f.name.toLowerCase().includes(q));
  const entries: PickerEntry[] = [
    ...(topItems ?? [])
      .filter((item) => item.label.toLowerCase().includes(q))
      .map((item) => ({ kind: "top" as const, ...item })),
    ...filtered.map((folder) => ({ kind: "folder" as const, folder })),
  ];

  function commit(entry: PickerEntry) {
    if (entry.kind === "top") entry.onSelect();
    else onCommit(entry.folder.id);
  }

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (anchor) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [anchor]);

  useEffect(() => {
    if (!anchor || !panelRef.current) return;
    const rect = anchor.getBoundingClientRect();
    const panel = panelRef.current;
    panel.style.top = `${rect.bottom + 6}px`;
    panel.style.left = `${rect.left}px`;
    // Full-width bar switcher: match the anchor so the dropdown lines up with
    // the field it opened from, instead of the fixed reroute width.
    if (matchAnchorWidth) panel.style.width = `${rect.width}px`;
  }, [anchor, matchAnchorWidth]);

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
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, entries.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = entries[activeIdx];
      if (chosen) commit(chosen);
    }
  }

  if (!anchor || typeof document === "undefined") return null;

  // Portaled to <body>: the panel is position:fixed and placed with viewport
  // coordinates, and .em-shell is a size container whose layout containment
  // would otherwise become the panel's containing block.
  return createPortal(
    <div ref={panelRef} className="em-reroute-panel" role="dialog" aria-label={dialogLabel ?? i18n._(msg`Re-route thread`)}>
      <div className="em-reroute-search">
        <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden>
          <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder={searchPlaceholder ?? i18n._(msg`Move to folder…`)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={i18n._(msg`Search folders`)}
          aria-autocomplete="list"
        />
      </div>

      <ul className="em-reroute-list" role="listbox">
        {entries.length === 0 && <li className="em-reroute-empty"><Trans>No folders match</Trans></li>}
        {entries.map((entry, i) => (
          <li
            key={entry.kind === "top" ? `__top_${entry.id}__` : entry.folder.id}
            role="option"
            aria-selected={i === activeIdx}
            className={`em-reroute-item${i === activeIdx ? " active" : ""}`}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseDown={(e) => { e.preventDefault(); commit(entry); }}
          >
            {entry.kind === "top" ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M1.3 5.6v1.9c0 .6.4 1 1 1h5.4c.6 0 1-.4 1-1V5.6M1.3 5.6h2.1l.7 1h1.8l.7-1h2.1M1.3 5.6l1-3.2c.1-.4.5-.7.9-.7h3.6c.4 0 .8.3.9.7l1 3.2" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              </svg>
            )}
            <span className="em-reroute-name">
              {entry.kind === "top" ? entry.label : entry.folder.name}
            </span>
            {(() => {
              const n = entry.kind === "top" ? entry.count : counts?.get(entry.folder.id);
              return n != null ? <span className="em-reroute-count">{i18n.number(n)}</span> : null;
            })()}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
