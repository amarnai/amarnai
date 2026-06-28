"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { FolderItem } from "./types.js";
import "./folder-tree.css";

const FOLDER_SVG = `<path d="M1.2 3.2h2.4l.8-.9h4.4v5.6H1.2V3.2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>`;
const MUTE_SVG = `<path d="M4 5.5v3h2L9 11V3L6 5.5H4z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
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
  const { i18n } = useLingui();
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
            <div
              role="button"
              tabIndex={0}
              className={[
                "em-tree-item",
                isActive ? "active" : "",
                root.ignored ? "ignored" : "",
                count > 0 ? "has-unread" : "",
                isOpen && children.length ? "open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => { onSelect?.(root.id); if (children.length) onToggle?.(root.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { onSelect?.(root.id); if (children.length) onToggle?.(root.id); } }}
            >
              <button
                type="button"
                className={`em-twirl${!children.length ? " empty" : ""}${isOpen ? " open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (children.length) onToggle?.(root.id);
                }}
                aria-label={isOpen ? i18n._(msg`Collapse`) : i18n._(msg`Expand`)}
                tabIndex={-1}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: TWIRL_SVG }}
                />
              </button>
              <span className="em-folder-icon">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden
                  dangerouslySetInnerHTML={{
                    __html: root.ignored ? MUTE_SVG : FOLDER_SVG,
                  }}
                />
              </span>
              <span className="em-tree-name">{root.name}</span>
              <span className="em-tree-count">{count || ""}</span>
            </div>

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
                        cCount > 0 ? "has-unread" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => onSelect?.(child.id)}
                    >
                      <span className="em-twirl empty" />
                      <span className="em-folder-icon">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          aria-hidden
                          dangerouslySetInnerHTML={{
                            __html: child.ignored ? MUTE_SVG : FOLDER_SVG,
                          }}
                        />
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
