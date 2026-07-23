import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ActiveSelection, FolderItem } from "@amarnai/ui/emails";
import { QUEUE_LABELS, ReroutePopover, getFolderAncestry } from "@amarnai/ui/emails";

type Props = {
  folders: FolderItem[];
  active: ActiveSelection;
  // Server-computed thread total for the active selection (filteredTotal), so
  // the count in the field stays accurate regardless of how many threads load.
  total: number;
  // Whole-workspace thread total, shown on the picker's "All mail" row.
  allCount: number;
  // Threads assigned to the current user, shown on the picker's "Assigned to
  // me" row.
  assignedCount: number;
  // Per-folder thread totals (server-computed), keyed by folder id, shown on
  // each picker row.
  folderCounts: Map<string, number>;
  // Search query for the thread list, relocated here from the list header.
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (a: ActiveSelection) => void;
};

// Scope indicator + switcher + search for the side panel's thread list. Styled
// as a select-shaped field (border, fill, right-edge chevron) rather than a
// title: the container is what signals "operable" — an icon or caret alone
// reads as decoration. Folder scopes render their ancestry as crumbs (tap =
// navigate up); the trailing button opens the shared folder picker (the same
// list that re-routes a thread, here committing a view change and showing
// per-folder counts). A search icon on the far right expands into a full-width
// input in place of the field.
export function ScopeField({
  folders,
  active,
  total,
  allCount,
  assignedCount,
  folderCounts,
  query,
  onQueryChange,
  onSelect,
}: Props) {
  const { _, i18n } = useLingui();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Seed the search box open when a query is already active. The panel unmounts
  // this whole field while the preview pane covers the list (≤640px layout), so
  // opening a thread from search results and closing it back remounts the field
  // fresh. The query itself lives in the triage view-model and survives that
  // round-trip, so without this the list would come back still filtered while
  // the search bar reads as closed — a filtered "X threads" count with no
  // visible search to explain it. Restoring the open state keeps the search
  // bar and its results together, matching how backing out of a message in
  // Gmail returns you to your search.
  const [searchOpen, setSearchOpen] = useState(() => query.trim().length > 0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const open = anchor != null;

  const isFolder = active.kind === "folder";
  const ancestry = isFolder ? getFolderAncestry(active.id, folders) : [];
  const parents = ancestry.slice(0, -1);
  const allMail = _(msg`All mail`);
  const leaf = isFolder
    ? (ancestry[ancestry.length - 1]?.name ?? "—")
    : active.id === "all"
      ? allMail
      : QUEUE_LABELS[active.id]
        ? i18n._(QUEUE_LABELS[active.id]!.name)
        : active.id;

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function go(a: ActiveSelection) {
    setAnchor(null);
    onSelect(a);
  }

  function closeSearch() {
    setSearchOpen(false);
    if (query) onQueryChange("");
  }

  if (searchOpen) {
    return (
      <div className="ax-scope-row">
        <div className="ax-scope-search">
          <span className="ax-scope-search-icon" aria-hidden>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            placeholder={_(msg`Search threads`)}
            aria-label={_(msg`Search threads`)}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button
            type="button"
            className="ax-scope-search-close"
            aria-label={_(msg`Close search`)}
            onClick={closeSearch}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ax-scope-row">
      <div ref={fieldRef} className="ax-scope-field" data-open={open ? "true" : "false"}>
        <span className="ax-scope-icon" aria-hidden>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M1.8 3.5c0-.7.6-1.3 1.3-1.3h2.6l1.4 1.6h4.8c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V3.5Z"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </span>

        {isFolder && (
          <>
            <button type="button" className="ax-scope-crumb" onClick={() => go({ kind: "queue", id: "all" })}>
              {allMail}
            </button>
            <span className="ax-scope-sep" aria-hidden>›</span>
            {parents.map((f) => (
              <span key={f.id} style={{ display: "contents" }}>
                <button type="button" className="ax-scope-crumb" onClick={() => go({ kind: "folder", id: f.id })}>
                  {f.name}
                </button>
                <span className="ax-scope-sep" aria-hidden>›</span>
              </span>
            ))}
          </>
        )}

        <button
          type="button"
          className="ax-scope-main"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={_(msg`Switch folder view`)}
          onClick={() => setAnchor((a) => (a ? null : fieldRef.current))}
        >
          <span className="ax-scope-label">{leaf}</span>
          <span className="ax-scope-count">{i18n.number(total)}</span>
          <span className="ax-scope-caret" aria-hidden>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </div>

      <button
        type="button"
        className="ax-scope-searchbtn"
        aria-label={_(msg`Search threads`)}
        onClick={() => setSearchOpen(true)}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <circle cx="6.3" cy="6.3" r="4.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9.6 9.6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <ReroutePopover
        folders={folders}
        anchor={anchor}
        onCommit={(folderId) => go({ kind: "folder", id: folderId })}
        onClose={() => setAnchor(null)}
        topItems={[
          { id: "all", label: allMail, count: allCount, onSelect: () => go({ kind: "queue", id: "all" }) },
          {
            id: "assigned",
            label: i18n._(QUEUE_LABELS.assigned!.name),
            count: assignedCount,
            onSelect: () => go({ kind: "queue", id: "assigned" }),
          },
        ]}
        counts={folderCounts}
        matchAnchorWidth
        searchPlaceholder={_(msg`Jump to folder…`)}
        dialogLabel={_(msg`Switch folder view`)}
      />
    </div>
  );
}
