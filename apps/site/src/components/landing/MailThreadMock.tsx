"use client";

import { useEffect, useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { OutlookIcon } from "@amarnai/ui";
import type { ThreadItem } from "@amarnai/ui/emails";
import { GmailLogoIcon } from "./icons";
import type { MockProvider } from "./MailInboxMock";
import { initial, outlookAvatarClass } from "./outlook-helpers";
import { DEMO_AVATARS } from "@/components/demo/demo-avatars";

/**
 * A stylized Gmail/Outlook conversation view for the landing demo. It stands in
 * for "opened in <provider>": the overlay a visitor lands on after clicking a
 * thread in the inbox mock or the workspace's "Open in <provider>" control. It
 * covers the mock inbox pane and returns to the split view on Back or Escape.
 *
 * Read-only and decorative. Gmail renders as a centered reading column; Outlook
 * renders as its reading pane (Reply / Reply all / Forward action bar, colored
 * avatars, and per-message "To" lines) so each matches the real product.
 */
export function MailThreadMock({
  provider,
  thread,
  onBack,
}: {
  provider: MockProvider;
  thread: ThreadItem;
  onBack: () => void;
}) {
  const { i18n, _ } = useLingui();
  const isOutlook = provider === "outlook";
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

  return (
    <div
      className={`ld-mailthread${isOutlook ? " ld-mailthread--outlook" : ""}`}
      data-provider={provider}
      role="dialog"
      aria-label={thread.subject}
    >
      <div className="ld-mailthread-bar">
        <button type="button" className="ld-mailthread-back" onClick={onBack}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="M9.5 12L5 7.5 9.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Trans>Back</Trans>
        </button>
        <span className="ld-mailthread-logo">
          {isOutlook ? (
            <>
              <OutlookIcon variant="color" size={16} />
              Outlook
            </>
          ) : (
            <>
              <GmailLogoIcon />
              Gmail
            </>
          )}
        </span>
      </div>

      {/* Outlook's reading pane leads with a Reply / Reply all / Forward bar.
          Decorative in this read-only mock, so it's hidden from assistive tech. */}
      {isOutlook && (
        <div className="ld-ol-actions" aria-hidden>
          <span className="ld-ol-action">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M6 3L2.5 6.5 6 10M2.5 6.5H8.5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {_(msg`Reply`)}
          </span>
          <span className="ld-ol-action">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L1.5 6.5 5 10M8 3L4.5 6.5 8 10M4.5 6.5h5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {_(msg`Reply all`)}
          </span>
          <span className="ld-ol-action">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8 3l3.5 3.5L8 10M11.5 6.5H5.5a3 3 0 00-3 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {_(msg`Forward`)}
          </span>
        </div>
      )}

      <div className="ld-mailthread-scroll">
        <h1 className="ld-mailthread-subject">{thread.subject}</h1>

        {thread.messages.map((m) => {
          // Show the sender's photo only on messages actually from the thread's
          // primary sender, so a future "You" reply keeps an initials avatar.
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
            </div>
            <div className="ld-mailthread-body">{m.bodyText ?? m.snippet}</div>
          </article>
          );
        })}

        {/* A dead reply affordance: this is a read-only mock, so it does nothing.
            It grounds the view as a real conversation pane rather than a preview.
            Outlook leads with its own action bar above, so this is Gmail-only. */}
        {!isOutlook && (
          <div className="ld-mailthread-reply" aria-hidden>
            <span className="ld-mailthread-reply-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M6 3L2.5 6.5 6 10M2.5 6.5H8.5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {_(msg`Reply`)}
          </div>
        )}
      </div>
    </div>
  );
}
