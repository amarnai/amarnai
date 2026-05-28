import { QUEUES } from "./selection";
import type { ActiveSelection, FolderItem } from "./selection";

function getFolderAncestry(folderId: string, folders: FolderItem[]): FolderItem[] {
  const chain: FolderItem[] = [];
  let current = folders.find((f) => f.id === folderId);
  while (current) {
    chain.unshift(current);
    const parentId = current.parentId;
    current = parentId ? folders.find((f) => f.id === parentId) : undefined;
  }
  return chain;
}

type Props = {
  active: ActiveSelection;
  folders: FolderItem[];
  threadCount: number;
  unreadCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  onSelectFolder: (id: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export function ThreadListHeader({
  active,
  folders,
  threadCount,
  unreadCount,
  query,
  onQueryChange,
  onSelectFolder,
  searchRef,
}: Props) {
  const isFolder = active.kind === "folder";
  const queue = !isFolder ? QUEUES.find((q) => q.id === active.id) : undefined;

  const title = isFolder
    ? (folders.find((f) => f.id === active.id)?.name ?? "—")
    : (queue?.name ?? "—");
  const desc = isFolder
    ? (folders.find((f) => f.id === active.id)?.description ?? "Threads sorted into this folder by Amarnai.")
    : (queue?.desc ?? "");

  const ancestry = isFolder ? getFolderAncestry(active.id, folders) : [];

  return (
    <div className="em-list-head">
      <div className="em-list-head-top">
        <div className="em-list-head-meta">
          <div className="em-crumbs">
            <span>Workspace</span>
            {isFolder ? (
              ancestry.map((f, i) => (
                <span key={f.id} style={{ display: "contents" }}>
                  <span className="sep">/</span>
                  {i < ancestry.length - 1 ? (
                    <button
                      type="button"
                      className="em-crumb-link"
                      onClick={() => onSelectFolder(f.id)}
                    >
                      {f.name}
                    </button>
                  ) : (
                    <span style={{ color: "var(--ink-2)" }}>{f.name}</span>
                  )}
                </span>
              ))
            ) : (
              <>
                <span className="sep">/</span>
                <span>Triage</span>
                <span className="sep">/</span>
                <span style={{ color: "var(--ink-2)" }}>{title}</span>
              </>
            )}
          </div>
          <div className="em-list-title">{title}</div>
          <div className="em-head-desc">{desc}</div>
        </div>
      </div>

      <div className="em-filter-row">
        <div className="em-filter-search">
          <svg className="icon-l" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder={`Search ${threadCount} threads`}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search threads"
          />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)" }}>
        {threadCount} thread{threadCount === 1 ? "" : "s"}
        {unreadCount > 0 && ` · ${unreadCount} unread`}
      </div>
    </div>
  );
}
