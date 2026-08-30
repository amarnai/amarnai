"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { MockProvider } from "./types.js";

/**
 * The Amarnai Reply flow inside the mail page, which runs in the order the real
 * extension runs it: the entry point opens the provider's own reply compose,
 * generation starts by itself, and the finished text lands in the compose body.
 * Nothing here is an Amarnai window — the draft ends up in the mailbox's editor,
 * under the mailbox's own Send button, which is the whole point of the feature.
 */
export type ReplyStage = "idle" | "drafting" | "ready";

/** How long the mock spends "drafting" before the body appears. */
export const DRAFTING_MS = 1400;

/**
 * The Amarnai Reply mark: the left-pointing wedge from the logo, the same
 * polygon the extension injects (content/core/replyIcon.ts, and its twin in the
 * extension's public/reply-button-icon.svg for InboxSDK's URL-only API). Keep
 * the points in step with those — this is the third copy of one drawing, and it
 * exists because none of the three can import from the others.
 */
export function AziruReplyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <polygon points="2,12 22,5.7 17.1,12 22,18.3" fill="currentColor" />
    </svg>
  );
}

/**
 * The entry point, styled as one of the host mailbox's own pills so it reads as
 * part of the reply row rather than an overlay dropped on top. It carries the
 * Amarnai mark because that is what tells a reader which pill is not Gmail's.
 */
export function AziruReplyPill({
  stage,
  onStart,
  provider,
}: {
  stage: ReplyStage;
  onStart: () => void;
  provider: MockProvider;
}) {
  const { _ } = useLingui();
  const drafting = stage === "drafting";

  return (
    <button
      type="button"
      className="ld-mb-reply-pill"
      data-provider={provider}
      data-drafting={drafting || undefined}
      disabled={drafting}
      onClick={onStart}
      aria-label={_(msg`Draft a reply with Amarnai`)}
    >
      {drafting ? (
        <>
          <span className="ld-mb-pill-spin" aria-hidden />
          <Trans>Drafting…</Trans>
        </>
      ) : (
        <>
          <AziruReplyIcon />
          <Trans>Amarnai Reply</Trans>
        </>
      )}
    </button>
  );
}

/**
 * The mailbox's reply compose, opened by the entry point above. The tray button
 * is the same control in its second position (the real extension puts it beside
 * Send), so a visitor who missed it in the reply row meets it here.
 *
 * Send is drawn but dead. It is the mailbox's button, not ours, and Amarnai
 * never sends: the draft waits here for edits either way.
 */
export function AziruCompose({
  provider,
  toName,
  body,
  stage,
  onDraft,
  onDiscard,
}: {
  provider: MockProvider;
  toName: string;
  body: string;
  stage: ReplyStage;
  /** Re-runs generation, as clicking the real tray button a second time does. */
  onDraft: () => void;
  onDiscard: () => void;
}) {
  const { _ } = useLingui();

  return (
    <div className="ld-mb-compose" data-provider={provider}>
      <div className="ld-mb-compose-head">
        <span className="ld-mb-compose-to">
          <Trans>To: {toName}</Trans>
        </span>
        <button
          type="button"
          className="ld-mb-compose-x"
          onClick={onDiscard}
          aria-label={_(msg`Discard this draft`)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* aria-live so a screen-reader user is told the draft arrived rather than
          being left on a box that silently filled in. */}
      <div className="ld-mb-compose-body" aria-live="polite">
        {stage === "ready" ? (
          <p className="ld-mb-compose-text">{body}</p>
        ) : (
          <span className="ld-mb-compose-caret" aria-hidden />
        )}
      </div>

      <div className="ld-mb-compose-foot">
        <span className="ld-mb-send" aria-hidden>
          <Trans>Send</Trans>
        </span>
        <AziruReplyPill stage={stage} onStart={onDraft} provider={provider} />
      </div>
    </div>
  );
}

/**
 * The Amarnai Reply icon button in a message's header row, beside the mailbox's
 * own reply arrow. Gmail-only: the real extension mounts it on the last message
 * of a thread, and clicking it opens the reply and starts drafting in one go,
 * exactly as the pill in the reply row does.
 */
export function AziruReplyHeaderButton({
  stage,
  onStart,
}: {
  stage: ReplyStage;
  onStart: () => void;
}) {
  const { _ } = useLingui();

  return (
    <button
      type="button"
      className="ld-mb-head-btn"
      disabled={stage === "drafting"}
      onClick={onStart}
      aria-label={_(msg`Draft a reply with Amarnai`)}
      title={_(msg`Amarnai Reply`)}
    >
      <AziruReplyIcon size={15} />
    </button>
  );
}
