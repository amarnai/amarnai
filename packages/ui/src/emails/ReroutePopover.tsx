"use client";

import { useEffect, useRef, useState } from "react";
import type { FolderItem } from "../folder-tree/types.js";

export interface ReroutePopoverProps {
  folders: FolderItem[];
  anchor: HTMLElement | null;
  onCommit: (folderId: string) => void;
  onClose: () => void;
}

export function ReroutePopover({ folders, anchor, onCommit, onClose }: ReroutePopoverProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = folders.filter(
    (f) => !f.ignored && f.name.toLowerCase().includes(query.toLowerCase()),
  );

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
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[activeIdx];
      if (chosen) onCommit(chosen.id);
    }
  }

  if (!anchor) return null;

  return (
    <div ref={panelRef} className="em-reroute-panel" role="dialog" aria-label="Re-route thread">
      <div className="em-reroute-search">
        <svg width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden>
          <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="Move to folder…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search folders"
          aria-autocomplete="list"
        />
      </div>

      <ul className="em-reroute-list" role="listbox">
        {filtered.length === 0 && <li className="em-reroute-empty">No folders match</li>}
        {filtered.map((folder, i) => (
          <li
            key={folder.id}
            role="option"
            aria-selected={i === activeIdx}
            className={`em-reroute-item${i === activeIdx ? " active" : ""}`}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseDown={(e) => { e.preventDefault(); onCommit(folder.id); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
            {folder.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
