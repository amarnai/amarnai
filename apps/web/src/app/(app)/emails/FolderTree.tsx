import type { ActiveSelection, FolderItem, ThreadItem } from "./selection";
import { countForActive, folderUnreadCount } from "./selection";

const FOLDER_SVG = `<path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>`;
const MUTE_SVG = `<path d="M4 5.5v3h2L9 11V3L6 5.5H4z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
const TWIRL_SVG = `<path d="M2.8 1.8l3 2.2-3 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;

type Props = {
  folders: FolderItem[];
  threads: ThreadItem[];
  active: ActiveSelection;
  openIds: Set<string>;
  railQuery: string;
  now: Date;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
};

export function FolderTree({
  folders,
  threads,
  active,
  openIds,
  railQuery,
  now,
  onToggle,
  onSelect,
}: Props) {
  const q = railQuery.trim().toLowerCase();
  const roots = folders.filter((f) => f.parentId === null);

  function matches(folder: FolderItem): boolean {
    if (!q) return true;
    if (folder.name.toLowerCase().includes(q)) return true;
    return folders.some(
      (c) => c.parentId === folder.id && c.name.toLowerCase().includes(q)
    );
  }

  if (!roots.length) {
    return (
      <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--ink-4)" }}>
        No folders defined
      </div>
    );
  }

  return (
    <>
      {roots.map((root) => {
        if (!matches(root)) return null;
        const children = folders.filter((f) => f.parentId === root.id);
        const isOpen = openIds.has(root.id) || !!q;
        const isActive = active.kind === "folder" && active.id === root.id;
        const allIds = new Set([root.id, ...children.map((c) => c.id)]);
        const count = countForActive(
          threads,
          folders,
          { kind: "folder", id: root.id },
          now
        );
        const unread = folderUnreadCount(threads, root.id, allIds);

        return (
          <div key={root.id}>
            <div
              role="button"
              tabIndex={0}
              className={[
                "em-tree-item",
                isActive ? "active" : "",
                root.ignored ? "ignored" : "",
                unread > 0 ? "has-unread" : "",
                isOpen && children.length ? "open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(root.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(root.id)}
            >
              <button
                type="button"
                className={`em-twirl${!children.length ? " empty" : ""}${isOpen ? " open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (children.length) onToggle(root.id);
                }}
                aria-label={isOpen ? "Collapse" : "Expand"}
                tabIndex={-1}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden dangerouslySetInnerHTML={{ __html: TWIRL_SVG }} />
              </button>
              <span className="em-folder-icon">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden dangerouslySetInnerHTML={{ __html: root.ignored ? MUTE_SVG : FOLDER_SVG }} />
              </span>
              <span className="em-tree-name">{root.name}</span>
              <span className="em-tree-count">{count}</span>
            </div>

            {children.length > 0 && isOpen && (
              <div className="em-tree-children">
                {children.map((child) => {
                  if (q && !child.name.toLowerCase().includes(q) && !root.name.toLowerCase().includes(q)) return null;
                  const cIsActive =
                    active.kind === "folder" && active.id === child.id;
                  const cIds = new Set([child.id]);
                  const cCount = countForActive(
                    threads,
                    folders,
                    { kind: "folder", id: child.id },
                    now
                  );
                  const cUnread = folderUnreadCount(threads, child.id, cIds);
                  return (
                    <button
                      key={child.id}
                      type="button"
                      className={[
                        "em-tree-item",
                        cIsActive ? "active" : "",
                        child.ignored ? "ignored" : "",
                        cUnread > 0 ? "has-unread" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => onSelect(child.id)}
                    >
                      <span className="em-twirl empty" />
                      <span className="em-folder-icon">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden dangerouslySetInnerHTML={{ __html: child.ignored ? MUTE_SVG : FOLDER_SVG }} />
                      </span>
                      <span className="em-tree-name">{child.name}</span>
                      <span className="em-tree-count">{cCount}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
