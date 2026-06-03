"use client";

import type { DoneMark } from "./types.js";

interface Props {
  isDone: boolean;
  doneMark: DoneMark | null;
  onMark: () => void;
  onUnmark: () => void;
}

export function PreviewDoneBar({ isDone, doneMark, onMark, onUnmark }: Props) {
  return (
    <button
      type="button"
      className={`em-preview-done-bar${isDone ? " is-done" : ""}`}
      onClick={isDone ? onUnmark : onMark}
      aria-pressed={isDone}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path d="M1.5 5l2.2 2.5L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {isDone && doneMark
        ? `Marked as done · ${doneMark.userName ?? doneMark.userEmail}`
        : "Mark as done"}
    </button>
  );
}
