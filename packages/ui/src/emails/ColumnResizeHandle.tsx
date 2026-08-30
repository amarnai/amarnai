"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";

type ResizableColumn = "rail" | "list";

type Props = {
  column: ResizableColumn;
};

const CSS_VAR: Record<ResizableColumn, string> = {
  rail: "--em-rail-w",
  list: "--em-list-w",
};

const STORAGE_KEY: Record<ResizableColumn, string> = {
  rail: "amarnai.emails.rail-width",
  list: "amarnai.emails.list-width",
};

const LABEL = {
  rail: msg`Resize the folder sidebar`,
  list: msg`Resize the thread list`,
};

const KEY_STEP_PX = 16;

function findGrid(el: HTMLElement | null): HTMLElement | null {
  return el?.closest<HTMLElement>(".em-grid") ?? null;
}

/** Rendered (clamped) width of the column, read off the resolved grid tracks. */
function renderedWidth(grid: HTMLElement, column: ResizableColumn): number | null {
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(" ");
  const px = Number.parseFloat(tracks[column === "rail" ? 0 : 1] ?? "");
  return Number.isFinite(px) ? px : null;
}

function readStoredWidth(column: ResizableColumn): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY[column]);
    const px = raw === null ? NaN : Number.parseFloat(raw);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

function storeWidth(column: ResizableColumn, px: number | null): void {
  try {
    if (px === null) window.localStorage.removeItem(STORAGE_KEY[column]);
    else window.localStorage.setItem(STORAGE_KEY[column], String(Math.round(px)));
  } catch {
    // Storage can be unavailable (privacy modes); resizing still works, it
    // just won't persist.
  }
}

/**
 * Drag handle on the right edge of a resizable emails-grid column. It drives
 * the grid's `--em-rail-w` / `--em-list-w` variables inline, so each surface
 * keeps its own stylesheet defaults until the user drags; double-click resets
 * back to those defaults.
 */
export function ColumnResizeHandle({ column }: Props) {
  const { _ } = useLingui();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  // Apply the persisted width after mount so server and client render the
  // same markup; the surface's CSS default applies when nothing is stored.
  useEffect(() => {
    const grid = findGrid(ref.current);
    const stored = readStoredWidth(column);
    if (grid && stored !== null) grid.style.setProperty(CSS_VAR[column], `${stored}px`);
  }, [column]);

  function beginDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const grid = findGrid(e.currentTarget);
    const width = grid ? renderedWidth(grid, column) : null;
    if (!grid || width === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width };
    grid.setAttribute("data-col-resizing", "true");
    setDragging(true);
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    const grid = findGrid(e.currentTarget);
    if (!start || !grid) return;
    // The grid template clamps the track, so the raw drag position is safe.
    grid.style.setProperty(CSS_VAR[column], `${Math.round(start.width + e.clientX - start.x)}px`);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    const grid = findGrid(e.currentTarget);
    if (!grid) return;
    grid.removeAttribute("data-col-resizing");
    // Persist the rendered (clamped) width, not the raw drag position, so a
    // stored value is always sensible for the surface it was saved on.
    storeWidth(column, renderedWidth(grid, column));
  }

  function resetToDefault(e: ReactMouseEvent<HTMLDivElement>) {
    const grid = findGrid(e.currentTarget);
    if (!grid) return;
    grid.style.removeProperty(CSS_VAR[column]);
    storeWidth(column, null);
  }

  function nudge(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const grid = findGrid(e.currentTarget);
    const width = grid ? renderedWidth(grid, column) : null;
    if (!grid || width === null) return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? -KEY_STEP_PX : KEY_STEP_PX;
    grid.style.setProperty(CSS_VAR[column], `${Math.round(width + delta)}px`);
    storeWidth(column, renderedWidth(grid, column));
  }

  return (
    <div
      ref={ref}
      className="em-col-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={_(LABEL[column])}
      tabIndex={0}
      data-column={column}
      data-dragging={dragging || undefined}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={resetToDefault}
      onKeyDown={nudge}
    />
  );
}
