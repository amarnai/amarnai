"use client";

import { Trans } from "@lingui/react/macro";
import { folderInkVar } from "@amarnai/core/emails";
import { Glyph, FOLDER_GLYPH, MUTE_GLYPH } from "../icons/glyphs.js";
import type { FolderItem } from "./types.js";
import "./folder-tree.css";

const TWIRL_SVG = `<path d="M2.8 1.8l3 2.2-3 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;

export interface FolderTreeProps {
  folders: FolderItem[];
  /** Precomputed thread counts keyed by folder ID. */
  counts?: Map<string, number>;
  /** ID of the currently selected folder. */
  activeId?: string | null;
  /** IDs of root folders that are currently expanded. */
  openIds?: Set<string>;
  /** Filter string — items not matching are hidden. */
  query?: string;
  onToggle?: (id: string) => void;
  onSelect?: (id: string) => void;
}

export function FolderTree({
  folders,
  counts,
  activeId,
  openIds = new Set(),
  query = "",
  onToggle,
  onSelect,
}: FolderTreeProps) {
  const q = query.trim().toLowerCase();
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
        <Trans>No folders defined</Trans>
      </div>
    );
  }

  return (
    <>
      {roots.map((root) => {
        if (!matches(root)) return null;
        const children = folders.filter((f) => f.parentId === root.id);
        const isOpen = openIds.has(root.id) || !!q;
        const isActive = activeId === root.id;
        const count = counts?.get(root.id) ?? 0;

        return (
          <div key={root.id}>
            {/* A single native button per row: selecting a root also toggles
                its children. The twirl is a decorative marker rather than a
                nested button, so the row stays a single interactive control
                (avoids the nested-interactive a11y violation). */}
            <button
              type="button"
              className={[
                "em-tree-item",
                isActive ? "active" : "",
                root.ignored ? "ignored" : "",
                isOpen && children.length ? "open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-expanded={children.length ? isOpen : undefined}
              onClick={() => { onSelect?.(root.id); if (children.length) onToggle?.(root.id); }}
            >
              <span
                className={`em-twirl${!children.length ? " empty" : ""}${isOpen ? " open" : ""}`}
                aria-hidden
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: TWIRL_SVG }}
                />
              </span>
              <span
                className="em-folder-icon"
                style={root.ignored ? undefined : { color: folderInkVar(root) }}
              >
                <Glyph svg={root.ignored ? MUTE_GLYPH : FOLDER_GLYPH} />
              </span>
              <span className="em-tree-name">{root.name}</span>
              <span className="em-tree-count">{count || ""}</span>
            </button>

            {children.length > 0 && isOpen && (
              <div className="em-tree-children">
                {children.map((child) => {
                  if (
                    q &&
                    !child.name.toLowerCase().includes(q) &&
                    !root.name.toLowerCase().includes(q)
                  )
                    return null;
                  const cIsActive = activeId === child.id;
                  const cCount = counts?.get(child.id) ?? 0;
                  return (
                    <button
                      key={child.id}
                      type="button"
                      className={[
                        "em-tree-item",
                        cIsActive ? "active" : "",
                        child.ignored ? "ignored" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => onSelect?.(child.id)}
                    >
                      <span className="em-twirl empty" />
                      <span
                        className="em-folder-icon"
                        style={child.ignored ? undefined : { color: folderInkVar(child) }}
                      >
                        <Glyph svg={child.ignored ? MUTE_GLYPH : FOLDER_GLYPH} />
                      </span>
                      <span className="em-tree-name">{child.name}</span>
                      <span className="em-tree-count">{cCount || ""}</span>
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
