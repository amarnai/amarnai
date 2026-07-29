"use client";

import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { buildThreadUrl } from "@amarnai/core/emails";
import type { PanelHost } from "../host.js";
import type { PanelQueueThread } from "../types.js";

// One thread in the queue.
//
// Two lines and a toggle, and no more: the panel is a 280-344px column, the
// mail client is already showing the inbox this thread came from, and anything
// richer would be a worse copy of the list a few inches to the left. What the
// row adds is that this thread is waiting on you, and one click to each of the
// two things you can do about it.

const CHECK_ICO = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
    <path
      d="M1.5 5l2.2 2.5L8.5 2"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export type QueueRowProps = {
  thread: PanelQueueThread;
  /** The mailbox reading it, so a link out lands in the right account. */
  accountEmail: string;
  host: PanelHost;
  /** Show this thread in the panel, and in the mail client where that is possible. */
  onOpen: () => void;
  onToggleDone: () => void;
};

export function QueueRow({ thread, accountEmail, host, onOpen, onToggleDone }: QueueRowProps) {
  const { _ } = useLingui();
  const isDone = !!thread.doneMark;
  const sender = thread.senderName ?? thread.senderEmail ?? _(msg`Unknown sender`);
  const subject = thread.subject ?? _(msg`(no subject)`);
  const doneLabel = isDone ? _(msg`Mark as not done`) : _(msg`Mark as done`);

  // The open affordance is a button where the host can navigate itself, and an
  // ordinary link where it cannot. Both are siblings of the toggle rather than
  // its parent: a button inside a button is invalid, and a row-wide click target
  // that swallows the toggle is worse than either.
  //
  // Both report the click the same way, and the panel switches to the thread on
  // the strength of that alone. The link still opens the conversation where the
  // host cannot; it is no longer the only thing the click does.
  const open = _(msg`Open conversation: ${subject}`);
  const body = (
    <>
      <span className="apn-queue-sender">{sender}</span>
      <span className="apn-queue-subject">{subject}</span>
    </>
  );

  return (
    <li className={`apn-queue-row${isDone ? " is-done" : ""}`}>
      {host.capabilities.openThread ? (
        <button
          type="button"
          className="apn-queue-open"
          aria-label={open}
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <a
          className="apn-queue-open"
          aria-label={open}
          href={buildThreadUrl(thread, accountEmail)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
        >
          {body}
        </a>
      )}
      <button
        type="button"
        className={`em-done-btn${isDone ? " is-done" : ""}`}
        aria-label={doneLabel}
        aria-pressed={isDone}
        onClick={onToggleDone}
      >
        {CHECK_ICO}
      </button>
    </li>
  );
}
