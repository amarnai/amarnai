"use client";

import { useMemo } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { OutlookIcon } from "../../icons/OutlookIcon.js";
import type { ThreadItem } from "../../emails/types.js";
import { initial, outlookAvatarClass } from "./outlook-helpers.js";
import { DEMO_AVATARS } from "../demo-avatars.js";
import { ProviderLabelChip } from "./ProviderLabelChip.js";
import type { AmarnaiDemoData } from "./types.js";

// 3x3 app-launcher waffle, the top-left glyph on every Outlook web page.
function WaffleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {[1, 6, 11].map((y) =>
        [1, 6, 11].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx="0.5" />),
      )}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <circle cx="5.5" cy="5.5" r="3.7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.5 8.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Slim line glyphs for the folder rail. Kept simple but recognizable: an inbox
// tray, a document, a paper plane, a trash can, an archive box, a blocked disc.
function InboxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5 8.5V3.2A1 1 0 0 1 2.5 2.2h9a1 1 0 0 1 1 1v5.3M1.5 8.5h3l1 1.6h3l1-1.6h3M1.5 8.5v2.3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
function DraftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 1.6h5l3 3v7.8H3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M8 1.6v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
function SentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M12.4 1.6 1.6 6l4.2 1.5M12.4 1.6 8 12.4l-2.2-4.9M12.4 1.6 5.8 7.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 3.5h9M5 3.5V2.3h4v1.2M3.4 3.5l.5 8h6.2l.5-8M6 5.6v3.8M8 5.6v3.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1.6" y="2.2" width="10.8" height="2.6" rx="0.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.6 4.8v6a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1v-6M5.6 7.2h2.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function JunkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.3 3.3l7.4 7.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A stylized Outlook web inbox for the extension mode of the landing demo. It
 * mirrors real Outlook's chrome so the pane reads as the actual product, the
 * same way MailInboxMock's Gmail layout mirrors Gmail: a blue app bar, a folder
 * rail (Inbox / Junk / Drafts / Sent / Deleted / Archive), the Focused/Other
 * pivot, and stacked message rows with colored initials avatars.
 *
 * It renders the same demo threads the Amarnai workspace beside it sorts, so the
 * two panes show one inbox, and it is where the mirrored folders show up as
 * Outlook categories: a colored pill under the preview line, carrying the same
 * writeback name Gmail nests as a label.
 *
 * Clicking a real row opens the Outlook reading-pane mock (MailThreadMock); the
 * skeleton filler rows below stay decorative. With `amarnai` null the list is a
 * plain Outlook inbox, which is the off side of the landing page's switch.
 */
export function OutlookInboxMock({
  threads,
  amarnai,
  onOpenThread,
}: {
  threads: ThreadItem[];
  amarnai: AmarnaiDemoData | null;
  onOpenThread: (thread: ThreadItem) => void;
}) {
  const { i18n } = useLingui();
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.locale, { month: "short", day: "numeric" }),
    [i18n.locale],
  );
  const unreadCount = threads.filter((t) => t.unread).length;

  const folders = [
    { key: "inbox", label: <Trans>Inbox</Trans>, icon: <InboxIcon />, active: true, count: unreadCount },
    { key: "junk", label: <Trans>Junk Email</Trans>, icon: <JunkIcon /> },
    { key: "drafts", label: <Trans>Drafts</Trans>, icon: <DraftIcon /> },
    { key: "sent", label: <Trans>Sent Items</Trans>, icon: <SentIcon /> },
    { key: "deleted", label: <Trans>Deleted Items</Trans>, icon: <TrashIcon /> },
    { key: "archive", label: <Trans>Archive</Trans>, icon: <ArchiveIcon /> },
  ];

  return (
    <div className="ld-ol">
      <div className="ld-ol-head">
        <span className="ld-ol-waffle">
          <WaffleIcon />
        </span>
        <span className="ld-ol-logo">
          <OutlookIcon variant="mono" size={18} />
          Outlook
        </span>
        <span className="ld-ol-search">
          <SearchIcon />
          <Trans>Search</Trans>
        </span>
        <span className="ld-ol-avatar">A</span>
      </div>

      <div className="ld-ol-body">
        <nav className="ld-ol-rail">
          <span className="ld-ol-new">
            <PlusIcon />
            <Trans>New mail</Trans>
          </span>
          <span className="ld-ol-rail-label">
            <Trans>Favorites</Trans>
          </span>
          {folders.map((f) => (
            <span key={f.key} className={`ld-ol-folder${f.active ? " active" : ""}`}>
              <span className="ld-ol-folder-ico">{f.icon}</span>
              <span className="ld-ol-folder-name">{f.label}</span>
              {f.count ? <span className="ld-ol-folder-count">{f.count}</span> : null}
            </span>
          ))}
        </nav>

        <div className="ld-ol-list-col">
          <div className="ld-ol-tabs">
            <span className="ld-ol-tab active">
              <Trans>Focused</Trans>
            </span>
            <span className="ld-ol-tab">
              <Trans>Other</Trans>
            </span>
          </div>

          <div className="ld-ol-list">
            {threads.map((t) => {
              const name = t.messages[0]?.fromName ?? t.participants;
              const avatar = DEMO_AVATARS[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`ld-ol-row${t.unread ? " unread" : ""}`}
                  onClick={() => onOpenThread(t)}
                >
                  <span className="ld-ol-unread-bar" aria-hidden />
                  {avatar ? (
                    <span className="ld-ol-av ld-ol-av-photo">
                      <img src={avatar} alt="" />
                    </span>
                  ) : (
                    <span className={`ld-ol-av ${outlookAvatarClass(name)}`}>{initial(name)}</span>
                  )}
                  <span className="ld-ol-row-main">
                    <span className="ld-ol-row-top">
                      <span className="ld-ol-sender">{name}</span>
                      <span className="ld-ol-time">{dateFmt.format(t.latestAt)}</span>
                    </span>
                    <span className="ld-ol-row-subject">{t.subject}</span>
                    <span className="ld-ol-row-preview">{t.snippet}</span>
                    {/* Outlook stacks a row's categories under the preview
                        line rather than inline with the subject. */}
                    {t.folderId && amarnai?.providerLabels[t.folderId] && (
                      <span className="ld-ol-row-cats">
                        <ProviderLabelChip
                          folderId={t.folderId}
                          segments={amarnai.providerLabels[t.folderId]!}
                          provider="outlook"
                        />
                      </span>
                    )}
                  </span>
                  {t.unread && <span className="ld-ol-unread-dot" aria-hidden />}
                </button>
              );
            })}

            {/* De-emphasized filler rows standing in for already-read mail below
                the real threads, hard-clipped at the pane edge so the list reads
                as a real inbox continuing below the fold. */}
            <div className="ld-ol-more">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="ld-ol-row ld-ol-skel">
                  <span className="ld-ol-unread-bar" aria-hidden />
                  <span className="ld-ol-av ld-ol-av-skel" />
                  <span className="ld-ol-row-main">
                    <span className="ld-ol-row-top">
                      <span className="ld-skel-sender" />
                      <span className="ld-skel-time" />
                    </span>
                    <span className="ld-skel-line" />
                    <span className="ld-skel-line ld-skel-line--short" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
