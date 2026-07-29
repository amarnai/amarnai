"use client";

import { useCallback, useId, useState } from "react";
import {
  readSectionCollapsed,
  writeSectionCollapsed,
  type QueueSectionKey,
} from "./sectionCollapse.js";

// One collapsible group of the queue.
//
// The count lives in the header rather than inside the list, so a collapsed
// section still says how much is behind it. Without that a section closed by
// default is indistinguishable from one that is empty, and the panel would look
// like it had nothing to offer at the exact moment it had the most.

export type QueueSectionProps = {
  section: QueueSectionKey;
  title: React.ReactNode;
  count: number;
  /** Where the user has never said otherwise. Only "assigned to you" starts open. */
  defaultCollapsed: boolean;
  children: React.ReactNode;
};

export function QueueSection({
  section,
  title,
  count,
  defaultCollapsed,
  children,
}: QueueSectionProps) {
  // Read once, at mount, from storage: the panel is remounted on every
  // navigation, and a section that reopened itself each time would be unusable.
  const [collapsed, setCollapsed] = useState(() =>
    readSectionCollapsed(section, defaultCollapsed),
  );
  const listId = useId();

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      writeSectionCollapsed(section, next);
      return next;
    });
  }, [section]);

  // An empty section is not collapsed, it is absent: a header promising nothing
  // is worse than the space it takes.
  if (count === 0) return null;

  return (
    <section className="apn-queue-section">
      <button
        type="button"
        className="apn-queue-header"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={toggle}
      >
        <span className="apn-queue-title">{title}</span>
        <span className="apn-queue-count">{count}</span>
        <span className="apn-queue-chevron" aria-hidden>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {!collapsed && (
        <ul className="apn-queue-list" id={listId}>
          {children}
        </ul>
      )}
    </section>
  );
}
