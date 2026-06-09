"use client";

import React, { useRef, useState, useId, useCallback } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom" | "left" | "right";

const OFFSET = 8;
const DELAY_MS = 400;

function computePos(rect: DOMRect, placement: Placement): { top: number; left: number } {
  switch (placement) {
    case "top":
      return { top: rect.top - OFFSET, left: rect.left + rect.width / 2 };
    case "bottom":
      return { top: rect.bottom + OFFSET, left: rect.left + rect.width / 2 };
    case "left":
      return { top: rect.top + rect.height / 2, left: rect.left - OFFSET };
    case "right":
      return { top: rect.top + rect.height / 2, left: rect.right + OFFSET };
  }
}

export interface TooltipProps {
  content: string;
  placement?: Placement;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}

export function Tooltip({ content, placement = "top", children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const id = useId();

  const show = useCallback((e: React.MouseEvent | React.FocusEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    timerRef.current = setTimeout(() => {
      setPos(computePos(rect, placement));
      setVisible(true);
    }, DELAY_MS);
  }, [placement]);

  const hide = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const child = React.cloneElement(children, {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    "aria-describedby": id,
  });

  return (
    <>
      {child}
      {visible && typeof document !== "undefined" && createPortal(
        <div
          id={id}
          role="tooltip"
          className={`tooltip-bubble tooltip-bubble--${placement}`}
          style={{ top: pos.top, left: pos.left }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
