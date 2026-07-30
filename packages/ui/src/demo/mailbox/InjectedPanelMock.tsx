"use client";

import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { CSSProperties } from "react";
import { folderColorVars } from "@amarnai/core/emails";
import { AmarnaiMark } from "../../icons/AmarnaiMark.js";
import type { ThreadItem } from "../../emails/types.js";
import type { MockProvider } from "./types.js";

/**
 * The Amarnai panel inside the mail page: Gmail's InboxSDK sidebar and OWA's
 * drawer. It starts collapsed to its icon in the mailbox's right rail, which is
 * how the real one starts, so the mailbox is never buried under two panels at
 * once and expanding it stays the visitor's choice.
 *
 * It shows what only the panel shows — where the thread was filed, how sure
 * Amarnai was, and the reply waiting on it. The TL;DR is deliberately not
 * repeated here: the injected summary card already sits in the message body a
 * few inches to the left, and the same paragraph twice reads as a bug.
 */
export function InjectedPanelMock({
  thread,
  folderName,
  draftBody,
  provider,
  open,
  onToggle,
}: {
  thread: ThreadItem;
  folderName: string;
  draftBody: string | undefined;
  provider: MockProvider;
  open: boolean;
  onToggle: () => void;
}) {
  const { _ } = useLingui();
  const confidence = Math.round((thread.confidence ?? 0) * 100);

  return (
    <>
      <div className="ld-mb-rail" data-provider={provider}>
        <button
          type="button"
          className="ld-mb-rail-btn"
          aria-expanded={open}
          aria-label={_(msg`Open the Amarnai panel`)}
          onClick={onToggle}
        >
          <AmarnaiMark size={16} />
        </button>
      </div>

      {open && (
        <aside className="ld-mb-panel" data-provider={provider}>
          <header className="ld-mb-panel-head">
            <span className="ld-mb-panel-brand">
              <AmarnaiMark size={13} />
              Amarnai
            </span>
            <button
              type="button"
              className="ld-mb-panel-x"
              onClick={onToggle}
              aria-label={_(msg`Close the Amarnai panel`)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="ld-mb-panel-body">
            <div className="ld-mb-panel-eyebrow">
              <Trans>Filed in</Trans>
            </div>
            <span className="ld-mb-panel-folder" style={folderColorVars({ id: thread.folderId ?? "" }) as CSSProperties}>
              {folderName}
            </span>
            {thread.assignment && (
              <p className="ld-mb-panel-assignee">
                <Trans>
                  Assigned to {thread.assignment.userName ?? thread.assignment.userEmail}
                </Trans>
              </p>
            )}
            <p className="ld-mb-panel-conf">
              {thread.status === "review" ? (
                <Trans>Waiting for your review · {confidence}% sure</Trans>
              ) : (
                <Trans>Sorted automatically · {confidence}% sure</Trans>
              )}
            </p>

            {draftBody && (
              <>
                <div className="ld-mb-panel-eyebrow">
                  <Trans>Suggested reply</Trans>
                </div>
                <p className="ld-mb-panel-draft">{draftBody}</p>
              </>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
