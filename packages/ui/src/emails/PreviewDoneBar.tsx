"use client";

import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { DoneMark } from "./types.js";

interface Props {
  isDone: boolean;
  doneMark: DoneMark | null;
  onMark: () => void;
  onUnmark: () => void;
  showDoneBy?: boolean;
}

export function PreviewDoneBar({ isDone, doneMark, onMark, onUnmark, showDoneBy = true }: Props) {
  const { i18n } = useLingui();
  const doneByName = doneMark ? (doneMark.userName ?? doneMark.userEmail) : "";
  const label =
    isDone && doneMark
      ? showDoneBy
        ? i18n._(msg`Marked as done · ${doneByName}`)
        : i18n._(msg`Marked as done`)
      : i18n._(msg`Mark as done`);
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
      {label}
    </button>
  );
}
