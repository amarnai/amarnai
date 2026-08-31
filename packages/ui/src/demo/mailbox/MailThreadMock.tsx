"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { ThreadItem } from "../../emails/types.js";
import { ThreadSummaryCard, type ThreadSummaryCardState } from "../../emails/ThreadSummaryCard.js";
import { initial, outlookAvatarClass } from "./outlook-helpers.js";
import { DEMO_AVATARS } from "../demo-avatars.js";
import { ProviderLabelChip } from "./ProviderLabelChip.js";
import {
  AziruReplyPill,
  AziruReplyHeaderButton,
  AziruCompose,
  DRAFTING_MS,
  type ReplyStage,
} from "./AziruReply.js";
import { InjectedPanelMock } from "./InjectedPanelMock.js";
import type { AziruDemoData, MockProvider } from "./types.js";

/**
 * A stylized Gmail/Outlook conversation view. It stands in for "opened in
 * <provider>": the view a visitor lands on after clicking a thread in the inbox
 * mock or the workspace's "Open in <provider>" control, and it is where three of
 * the four things the extension injects live — the label on the thread, the
 * summary card above the messages, and the Aziru Reply entry point in the
 * mailbox's own reply row.
 *
 * Gmail renders as a centered reading column; Outlook renders as its reading
 * pane (Reply / Reply all / Forward action bar, colored avatars, per-message
 * "To" lines) so each matches the real product. With `aziru` null the view is
 * the bare mailbox, which is the comparison the landing page's switch turns on
 * and off; everything Aziru adds hangs off that one prop being non-null.
 */
export function MailThreadMock({
  provider,
  thread,
  aziru,
  folderName,
  onBack,
  initialReplyStage,
}: {
  provider: MockProvider;
  thread: ThreadItem;
  /** The Aziru layer, or null for the untouched mailbox. */
  aziru: AziruDemoData | null;
  /** Display name of the thread's folder, for the injected panel. */
  folderName: string;
  onBack: () => void;
  /**
   * Where the Aziru Reply flow starts. Defaults to "idle" (the pill, waiting
   * to be clicked); the store-tile artboards pass "ready" to freeze the view
   * on a finished draft, since a screenshot can't click.
   */
  initialReplyStage?: ReplyStage | undefined;
}) {
  const { i18n, _ } = useLingui();
  const isOutlook = provider === "outlook";
  const [replyStage, setReplyStage] = useState<ReplyStage>(initialReplyStage ?? "idle");
  const [panelOpen, setPanelOpen] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [i18n.locale],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack]);

  // Turning the Aziru layer off mid-draft has to take the compose with it:
  // that compose is only open because an Aziru entry point opened it.
  useEffect(() => {
    if (aziru) return;
    setReplyStage("idle");
    setPanelOpen(false);
  }, [aziru]);

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );

  function startDraft() {
    setReplyStage("drafting");
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => setReplyStage("ready"), DRAFTING_MS);
  }

  const labelSegments = thread.folderId ? aziru?.providerLabels[thread.folderId] : undefined;
  const draftBody = aziru?.draftBodies[thread.id];
  const replyToName = thread.messages[0]?.fromName ?? thread.participants;

  // The summary the injected card shows. A thread Aziru actually summarized
  // gets its TL;DR; everything else falls back to the stored snippet labelled
  // "Preview", which is what the real widget does for single-message and
  // automated threads — no model call, no stored summary, no metered unit.
  const bullets = aziru?.summaryBullets[thread.id];
  const prose = aziru?.summaries[thread.id];
  const summaryState: ThreadSummaryCardState = bullets
    ? { kind: "bullets", bullets }
    : prose
      ? { kind: "summary", text: prose }
      : { kind: "snippet", text: thread.snippet };

  const aziruPill = aziru ? (
    <AziruReplyPill stage={replyStage} onStart={startDraft} provider={provider} />
  ) : null;

  return (
    <div
      className={`ld-mailthread${isOutlook ? " ld-mailthread--outlook" : ""}`}
      data-provider={provider}
      role="dialog"
      aria-label={thread.subject}
    >
      <div className="ld-mailthread-main">
        <div className="ld-mailthread-col">
          {/* Outlook's reading pane leads with a Reply / Reply all / Forward
              bar. Its own actions are decorative in this read-only mock, so
              they stay hidden from assistive tech; the Aziru pill beside them
              is live and stays in the tree. */}
          {isOutlook && (
            <div className="ld-ol-actions">
              <span className="ld-ol-action" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M6 3L2.5 6.5 6 10M2.5 6.5H8.5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {_(msg`Reply`)}
              </span>
              <span className="ld-ol-action" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 3L1.5 6.5 5 10M8 3L4.5 6.5 8 10M4.5 6.5h5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {_(msg`Reply all`)}
              </span>
              <span className="ld-ol-action" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8 3l3.5 3.5L8 10M11.5 6.5H5.5a3 3 0 00-3 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {_(msg`Forward`)}
              </span>
              {aziruPill}
            </div>
          )}

          <div className="ld-mailthread-scroll">
            <h1 className="ld-mailthread-subject">
              {/* Gmail's back arrow sits on the thread, level with the subject,
                  not in a bar of its own. Escape does the same thing. */}
              <button
                type="button"
                className="ld-mailthread-back"
                onClick={onBack}
                aria-label={_(msg`Back to the inbox`)}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path d="M8 4l-5 6 5 6M3 10h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {thread.subject}
              {labelSegments && thread.folderId && (
                <ProviderLabelChip
                  folderId={thread.folderId}
                  segments={labelSegments}
                  provider={provider}
                />
              )}
            </h1>

            {/* The injected summary card, above the messages, where the content
                script mounts it. */}
            {aziru && (
              <div className="ld-mb-summary">
                <ThreadSummaryCard state={summaryState} withMark />
              </div>
            )}

            {thread.messages.map((m, i) => {
              // Gmail puts a reply arrow in each message's header row, and the
              // extension mounts its own entry point beside the one on the last
              // message. Same single-click behavior as the pill below.
              const isLast = i === thread.messages.length - 1;
              // Show the sender's photo only on messages actually from the
              // thread's primary sender, so a future "You" reply keeps an
              // initials avatar.
              const avatar =
                m.fromEmail === thread.messages[0]?.fromEmail ? DEMO_AVATARS[thread.id] : undefined;
              return (
                <article key={m.id} className="ld-mailthread-msg">
                  <div className="ld-mailthread-msg-head">
                    {avatar ? (
                      <span className="ld-mailthread-avatar ld-mailthread-avatar--photo" aria-hidden>
                        <img src={avatar} alt="" />
                      </span>
                    ) : (
                      <span
                        className={`ld-mailthread-avatar${isOutlook ? ` ${outlookAvatarClass(m.fromName)}` : ""}`}
                        aria-hidden
                      >
                        {initial(m.fromName)}
                      </span>
                    )}
                    <div className="ld-mailthread-from">
                      <span className="ld-mailthread-name">{m.fromName}</span>
                      {isOutlook ? (
                        <span className="ld-mailthread-email">
                          <Trans>To: You</Trans>
                        </span>
                      ) : (
                        <span className="ld-mailthread-email">{m.fromEmail}</span>
                      )}
                    </div>
                    <span className="ld-mailthread-time">{fmt.format(m.time)}</span>
                    {!isOutlook && isLast && (
                      <span className="ld-mailthread-msg-actions">
                        <span className="ld-mailthread-head-reply" aria-hidden>
                          <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                            <path d="M6 3L2.5 6.5 6 10M2.5 6.5H8.5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        {aziru && (
                          <AziruReplyHeaderButton stage={replyStage} onStart={startDraft} />
                        )}
                      </span>
                    )}
                  </div>
                  <div className="ld-mailthread-body">{m.bodyText ?? m.snippet}</div>
                </article>
              );
            })}

            {replyStage === "idle" ? (
              // Gmail's reply row at the foot of a thread. Its own Reply button
              // is a dead affordance in this read-only mock; the Aziru pill
              // beside it is the live one, and that is where the real extension
              // puts it too. Outlook leads with its action bar instead.
              !isOutlook && (
                <div className="ld-mailthread-reply">
                  <span className="ld-mailthread-reply-btn" aria-hidden>
                    <span className="ld-mailthread-reply-icon">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M6 3L2.5 6.5 6 10M2.5 6.5H8.5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    {_(msg`Reply`)}
                  </span>
                  {aziruPill}
                </div>
              )
            ) : (
              <AziruCompose
                provider={provider}
                toName={replyToName}
                body={draftBody ?? ""}
                stage={replyStage}
                onDraft={startDraft}
                onDiscard={() => setReplyStage("idle")}
              />
            )}
          </div>
        </div>

        {aziru && (
          <InjectedPanelMock
            thread={thread}
            folderName={folderName}
            draftBody={draftBody}
            provider={provider}
            open={panelOpen}
            onToggle={() => setPanelOpen((o) => !o)}
          />
        )}
      </div>
    </div>
  );
}
